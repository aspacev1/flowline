import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "dotenv/config";

import authRouter from "./routes/auth.js";
import oauthRouter from "./routes/oauth.js";
import projectsRouter from "./routes/projects.js";
import workItemsRouter from "./routes/workItems.js";
import teamRouter from "./routes/team.js";
import invitesRouter from "./routes/invites.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/auth/oauth", oauthRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/team", teamRouter);
app.use("/api/invites", invitesRouter);
app.use("/api", workItemsRouter); // содержит /projects/:id/work-items и /work-items/:id

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});

app.listen(PORT, () => {
  console.log(`Flowline backend listening on port ${PORT}`);
});
