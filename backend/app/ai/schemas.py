"""Схемы того, что возвращает модель.

Схема — язык-независимая: на языке пользователя приходят значения, а не ключи.
Иначе интервью на азербайджанском вернуло бы поля с азербайджанскими именами, и
разбирать их пришлось бы по языку сессии.

Проверка идёт на нашей стороне, а не только в `response_format` запроса:
обещаниям модели верить нельзя, и «строгий режим» одного облака ничего не
говорит о локальной модели за тем же адресом.
"""

from datetime import date

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.models import Criticality

# --- шаг 1: следующий вопрос -------------------------------------------------

QUESTION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["question", "covered_topics"],
    "properties": {
        "question": {"type": "string"},
        # Модель сама отмечает, какие темы уже закрыты: список обязательных тем
        # держит бэк, а решение «этот ответ закрыл тему сроков» требует чтения
        # ответа, а не сопоставления строк.
        "covered_topics": {"type": "array", "items": {"type": "string"}},
    },
}


class NextQuestion(BaseModel):
    model_config = ConfigDict(extra="ignore")

    question: str = Field(min_length=1)
    covered_topics: list[str] = Field(default_factory=list)


# --- шаг 2: конспект ---------------------------------------------------------

SUMMARY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["theses"],
    "properties": {"theses": {"type": "array", "items": {"type": "string"}}},
}


class Summary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    theses: list[str] = Field(min_length=1)


# --- шаг 3: черновик ---------------------------------------------------------

DRAFT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["categories"],
    "properties": {
        "categories": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "tasks"],
                "properties": {
                    "name": {"type": "string"},
                    "tasks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["name", "start_date", "duration_days"],
                            "properties": {
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                                "start_date": {"type": "string"},
                                "duration_days": {"type": "integer", "minimum": 1},
                                "criticality": {
                                    "type": "string",
                                    "enum": [level.value for level in Criticality],
                                },
                            },
                        },
                    },
                },
            },
        }
    },
}


class DraftTask(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=300)
    description: str = ""
    start_date: date
    duration_days: int = Field(ge=1)
    criticality: Criticality = Criticality.NORMAL


class DraftCategory(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=200)
    tasks: list[DraftTask] = Field(default_factory=list)


class Draft(BaseModel):
    model_config = ConfigDict(extra="ignore")

    categories: list[DraftCategory] = Field(min_length=1)


# --- шаг «разбить задачу» ----------------------------------------------------

SPLIT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["parts"],
    "properties": {
        "parts": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "duration_days"],
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "duration_days": {"type": "integer", "minimum": 1},
                },
            },
        }
    },
}


class SplitPart(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=300)
    description: str = ""
    duration_days: int = Field(ge=1)


class Split(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # 3–5 частей: одна часть — это не разбиение, а десять превращают карточку
    # в список дел.
    parts: list[SplitPart] = Field(min_length=2, max_length=8)


def parse(model: type[BaseModel], payload: dict):
    """Разбор ответа модели с понятным отказом.

    ValidationError наружу не выходит: она проза на английском, а сообщения
    собирает клиент по машинному коду.
    """
    from app.ai.provider import LlmError

    try:
        return model.model_validate(payload)
    except ValidationError as error:
        raise LlmError("llm_schema_mismatch", f"ответ не по схеме: {error.error_count()} ошибок")
