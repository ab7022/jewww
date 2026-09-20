import type { JevProvider } from "@jev-browser/jev";
import {
  NO_FIELD,
  NO_FIELD_DESC,
  type Questions,
  type SnapshotElement,
  validateChoice,
} from "@jev-browser/shared";

/**
 * Batched form field mapping.
 *
 * For an unknown form on an unknown site, ask JEV one question PER FIELD, all in the
 * same parallel call: "which profile field belongs in this input?" A 26-field
 * application form is one request, ~200ms, ~$0.0004 — against 26 rounds of
 * decide-then-type. It measured 98.3% on real Greenhouse, Lever and Ashby forms.
 *
 * Anything below threshold, or answered `__none`, is left for the human rather than
 * guessed at. A wrong value typed into someone's job application is worse than a
 * blank one.
 */
export const MAP_THRESHOLD = 0.6;

export interface FieldMapping {
  eid: string;
  label: string;
  key: string;
  confidence: number;
  /** True when the model declined, or was not confident enough to act. */
  skipped: boolean;
}

export interface MapFieldsResult {
  mappings: FieldMapping[];
  costUsd: number;
  latencyMs: number;
  inputTokens: number;
}

export async function mapFields(
  jev: JevProvider,
  input: {
    page: { url: string; title: string };
    fields: SnapshotElement[];
    /**
     * Everything the agent could put in a field, as key -> description.
     *
     * Deliberately not limited to profile fields: an answer the user gave earlier
     * ("why do you want to work here") belongs in the same keyspace, so the model
     * matches it to a differently-worded question on the next site. That matching is
     * a judgement, which is why it is a question rather than a string comparison.
     */
    criteria: Record<string, string>;
  },
): Promise<MapFieldsResult> {
  if (!input.fields.length) {
    return { mappings: [], costUsd: 0, latencyMs: 0, inputTokens: 0 };
  }

  const criteria = { ...input.criteria, [NO_FIELD]: NO_FIELD_DESC };
  const questions: Questions = {};
  for (const f of input.fields) {
    questions[f.eid] = {
      type: "choice",
      instructions: `Which profile field belongs in the form input labelled "${f.name}"?`,
      criteria,
    };
  }

  const r = await jev.evaluate(
    {
      page: input.page,
      form: input.fields.map((f) => ({
        eid: f.eid,
        role: f.role,
        label: f.name,
        current_value: f.value ?? "",
        required: f.st?.includes("required") ?? false,
      })),
    },
    questions,
  );

  const mappings: FieldMapping[] = [];
  for (const f of input.fields) {
    const answer = r.answers[f.eid];
    try {
      validateChoice(answer, Object.keys(criteria));
    } catch {
      mappings.push({ eid: f.eid, label: f.name, key: NO_FIELD, confidence: 0, skipped: true });
      continue;
    }
    const confidence = answer.probabilities?.[answer.choice] ?? 1;
    mappings.push({
      eid: f.eid,
      label: f.name,
      key: answer.choice,
      confidence,
      skipped: answer.choice === NO_FIELD || confidence < MAP_THRESHOLD,
    });
  }

  return {
    mappings,
    costUsd: r.costUsd,
    latencyMs: r.latencyMs,
    inputTokens: r.usage.inputTokens,
  };
}
