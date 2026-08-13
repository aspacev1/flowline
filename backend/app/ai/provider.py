"""Провайдер LLM за тонким интерфейсом: `generate(messages, schema) -> dict`.

Тонкий он не ради красоты: смена провайдера или переход на локальную модель не
должны задевать остальной код. Всё, что знает приложение о модели, — что она
принимает список сообщений и возвращает объект по схеме.

Сети в тестах нет и быть не должно: интервью и разбор ответа проверяются на
записанных ответах модели, и `RecordedProvider` — не заглушка «чтобы
компилировалось», а полноправная реализация того же интерфейса.
"""

import json
import urllib.error
import urllib.request
from typing import Protocol


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    """Отказ следовать за редиректами.

    Адрес LLM проверяется на публичность до запроса, но проверка ничего не
    стоит, если публичный адрес может ответить 302 на внутренний: редирект
    выполняется уже без всякой проверки. Ответ 3xx превращается в HTTPError
    и ловится как обычный отказ модели.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ARG002
        return None


_opener = urllib.request.build_opener(_NoRedirects())


class LlmError(Exception):
    """Модель не ответила или ответила мусором.

    Переписка и черновик при этом сохраняются, а сессия продолжается с того же
    места: сбой модели не должен стоить человеку получаса разговора.
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class LlmProvider(Protocol):
    def generate(self, messages: list[dict], schema: dict) -> tuple[dict, int]:
        """Ответ модели по схеме и число израсходованных токенов."""
        ...


class HttpProvider:
    """Любой сервис с OpenAI-совместимым `/chat/completions`.

    Именно совместимость, а не «OpenAI»: адрес и модель приходят из настроек
    организации, и тот же код работает с локальной моделью за llama.cpp или
    vLLM. urllib вместо клиента провайдера — по той же причине: клиент привязал
    бы к одному облаку то, что обещано открытым.
    """

    def __init__(self, *, base_url: str, model: str, api_key: str, timeout: int):
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._model = model
        self._key = api_key
        self._timeout = timeout

    def generate(self, messages: list[dict], schema: dict) -> tuple[dict, int]:
        payload = json.dumps(
            {
                "model": self._model,
                "messages": messages,
                # Схема передаётся модели, а не только проверяется после: это
                # дешевле одного лишнего повтора, а проверка на нашей стороне
                # всё равно остаётся — обещаниям модели верить нельзя.
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {"name": "planora", "schema": schema, "strict": True},
                },
            }
        ).encode()
        request = urllib.request.Request(
            self._url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._key}",
            },
        )
        # Проверка адреса — на каждом запросе, а не только при сохранении
        # настроек: DNS-запись хоста могла смениться после сохранения
        # (перепривязка — обычный приём SSRF). Импорт локальный, чтобы не
        # завести цикл: netguard поднимает LlmError отсюда же.
        from app.ai.netguard import ensure_public_https

        ensure_public_https(self._url)
        try:
            with _opener.open(request, timeout=self._timeout) as response:
                body = json.loads(response.read())
        except urllib.error.HTTPError as error:
            raise LlmError("llm_refused", f"модель ответила {error.code}") from error
        except (urllib.error.URLError, OSError) as error:
            raise LlmError("llm_unreachable", str(error)) from error
        except json.JSONDecodeError as error:
            raise LlmError("llm_bad_json", "ответ не разобрать как JSON") from error

        try:
            content = body["choices"][0]["message"]["content"]
            tokens = int(body.get("usage", {}).get("total_tokens", 0))
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise LlmError("llm_bad_shape", "в ответе нет ожидаемых полей") from error

        try:
            return json.loads(content), tokens
        except json.JSONDecodeError as error:
            raise LlmError("llm_bad_json", "модель вернула не JSON") from error


class RecordedProvider:
    """Заранее записанные ответы, по одному на вызов.

    Ими проверяется всё, что не про сеть: и валидная схема, и битая. Кончились
    записи — это ошибка теста, а не поведение модели, и она должна выглядеть
    именно так.
    """

    def __init__(self, responses: list[dict | Exception], tokens: int = 100):
        self._responses = list(responses)
        self._tokens = tokens
        self.calls: list[list[dict]] = []

    def generate(self, messages: list[dict], schema: dict) -> tuple[dict, int]:
        self.calls.append(messages)
        if not self._responses:
            raise AssertionError("записанные ответы модели кончились")
        answer = self._responses.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer, self._tokens
