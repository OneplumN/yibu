import { REPORT_TYPE_LABELS } from "../constants";
import { requestChatCompletion } from "./llmClient";
import type { ReportDraft, ReportType } from "../../types/report";

function asBulletList(items: string[]) {
  if (items.length === 0) {
    return "- 暂无";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

export type ReportGenerationOptions = {
  signal?: AbortSignal;
  apiKey?: string;
  endpoint?: string;
  extraBodyJson?: string;
  modelName?: string;
  roleName?: string;
  rolePrompt?: string;
};

function buildTemplateReport(
  draft: ReportDraft,
  type: ReportType,
  generation?: ReportGenerationOptions,
) {
  const generationLines = [
    generation?.modelName ? `模型：${generation.modelName}` : "",
    generation?.roleName ? `角色：${generation.roleName}` : "",
  ].filter(Boolean);

  return [
    `${REPORT_TYPE_LABELS[type]}`,
    ...generationLines,
    "",
    "本期概览",
    draft.overview || "暂无概览。",
    "",
    "任务最终态",
    asBulletList(draft.completedItems),
    "",
    "关键改动",
    asBulletList(draft.keyChanges),
    "",
    "风险与阻塞",
    asBulletList(draft.blockers),
    "",
    "后续动作",
    asBulletList(draft.nextSteps),
  ].join("\n");
}

function buildReportPrompt(draft: ReportDraft, type: ReportType) {
  return [
    `报告类型：${REPORT_TYPE_LABELS[type]}`,
    "",
    "请基于以下已完成任务生成一份简洁、清晰、可直接发送的工作报告。",
    "要求：保留事实，不编造；用中文；结构包含概览、完成事项、关键改动、风险与后续动作。",
    "",
    "概览：",
    draft.overview || "暂无概览。",
    "",
    "任务最终态：",
    asBulletList(draft.completedItems),
    "",
    "关键改动：",
    asBulletList(draft.keyChanges),
    "",
    "风险与阻塞：",
    asBulletList(draft.blockers),
    "",
    "后续动作：",
    asBulletList(draft.nextSteps),
  ].join("\n");
}

async function requestPolishedReport(
  draft: ReportDraft,
  type: ReportType,
  generation: ReportGenerationOptions,
) {
  const endpoint = generation.endpoint?.trim();
  if (!endpoint) {
    return null;
  }

  return requestChatCompletion({
    signal: generation.signal,
    apiKey: generation.apiKey,
    endpoint,
    extraBodyJson: generation.extraBodyJson,
    messages: [
      {
        content:
          generation.rolePrompt?.trim() ||
          "你是一个严谨的工作报告助手，擅长把任务记录整理成可直接发送的报告。",
        role: "system",
      },
      {
        content: buildReportPrompt(draft, type),
        role: "user",
      },
    ],
    model: generation.modelName?.trim() || "default",
    temperature: 0.3,
  });
}

export async function polishReport(
  draft: ReportDraft,
  type: ReportType,
  generation?: ReportGenerationOptions,
) {
  const remoteReport = generation
    ? await requestPolishedReport(draft, type, generation)
    : null;

  return remoteReport ?? buildTemplateReport(draft, type, generation);
}
