import { buildUserPrompt, getSystemPrompt } from "../prompts/classifier";
import type { ClassificationInput, ClassificationResult, Env } from "../types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLASSIFIER_MODEL = "claude-haiku-4-5-20251001";

export class ClassifierError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ClassifierError";
	}
}

export class ClassifierApiError extends ClassifierError {
	constructor(
		message: string,
		public readonly status: number,
		public readonly body: string,
	) {
		super(message);
		this.name = "ClassifierApiError";
	}
}

export class ClassifierParseError extends ClassifierError {
	constructor(
		message: string,
		public readonly rawText: string,
	) {
		super(message);
		this.name = "ClassifierParseError";
	}
}

interface AnthropicMessagesResponse {
	content?: Array<{ type: string; text?: string }>;
}

export async function classifyMessage(
	env: Env,
	input: ClassificationInput,
): Promise<ClassificationResult> {
	const system = getSystemPrompt();
	const userContent = buildUserPrompt(input);

	const res = await fetch(ANTHROPIC_API_URL, {
		method: "POST",
		headers: {
			"x-api-key": env.ANTHROPIC_API_KEY,
			"anthropic-version": "2023-06-01",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: CLASSIFIER_MODEL,
			max_tokens: 1024,
			temperature: 0,
			system,
			messages: [{ role: "user", content: userContent }],
		}),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new ClassifierApiError(
			`Anthropic API 호출 실패: ${res.status} ${res.statusText}`,
			res.status,
			body,
		);
	}

	const data = (await res.json()) as AnthropicMessagesResponse;
	const textBlock = data.content?.find(
		(b) => b.type === "text" && typeof b.text === "string",
	);
	const rawText = textBlock?.text ?? "";

	if (!rawText) {
		throw new ClassifierParseError(
			"Anthropic 응답에 텍스트 블록이 없습니다.",
			JSON.stringify(data),
		);
	}

	const parsed = parseJsonFromText(rawText);
	validateClassification(parsed, rawText);
	return parsed;
}

function parseJsonFromText(text: string): ClassificationResult {
	let cleaned = text.trim();

	const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
	if (fenceMatch) {
		cleaned = fenceMatch[1].trim();
	}

	const firstBrace = cleaned.indexOf("{");
	const lastBrace = cleaned.lastIndexOf("}");
	if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
		cleaned = cleaned.slice(firstBrace, lastBrace + 1);
	}

	try {
		return JSON.parse(cleaned) as ClassificationResult;
	} catch (err) {
		throw new ClassifierParseError(
			`JSON 파싱 실패: ${(err as Error).message}`,
			text,
		);
	}
}

function validateClassification(
	value: unknown,
	rawText: string,
): asserts value is ClassificationResult {
	if (!value || typeof value !== "object") {
		throw new ClassifierParseError("분류 결과가 객체가 아닙니다.", rawText);
	}
	const obj = value as Record<string, unknown>;
	const missing: string[] = [];
	if (typeof obj.intent !== "string") missing.push("intent");
	if (typeof obj.confidence !== "string") missing.push("confidence");
	if (typeof obj.stage_change !== "object" || obj.stage_change === null)
		missing.push("stage_change");
	if (typeof obj.field_updates !== "object" || obj.field_updates === null)
		missing.push("field_updates");
	if (typeof obj.suggested_reply !== "string") missing.push("suggested_reply");
	if (typeof obj.human_review_needed !== "boolean")
		missing.push("human_review_needed");

	if (missing.length > 0) {
		throw new ClassifierParseError(
			`분류 결과 필수 필드 누락/타입 오류: ${missing.join(", ")}`,
			rawText,
		);
	}
}
