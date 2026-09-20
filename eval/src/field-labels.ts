import { NO_FIELD, type ProfileKey } from "@jev-browser/shared";

/**
 * Ground truth for field mapping, from DETERMINISTIC rules — never from a model.
 * A benchmark whose labels came from an LLM would only measure agreement with that
 * LLM. Anything these rules cannot decide is left unlabelled and excluded from
 * scoring, and the report says how many that was.
 */
const RULES: [RegExp, ProfileKey | typeof NO_FIELD][] = [
  // MOST SPECIFIC FIRST. A "how did you hear about us" dropdown lists LinkedIn among
  // its options, so this must be decided before the linkedin rule sees the text.
  [/how did you (hear|find)|referral source/i, NO_FIELD],

  [/^first\s*name/i, "firstName"],
  [/^(last|family)\s*name|^surname/i, "lastName"],
  [/^(full|legal|your)?\s*name\b/i, "fullName"],
  [/e-?mail/i, "email"],
  [/\bphone\b|\bmobile\b/i, "phone"],
  [/linkedin/i, "linkedin"],
  [/github/i, "github"],
  [/website|portfolio|personal site/i, "portfolio"],
  [/^country/i, "country"],
  [/^(location|city)\b/i, "city"],
  [/^(state|province)/i, "state"],
  [/\bzip\b|postal code/i, "postalCode"],
  [/street address|address line/i, "addressLine1"],
  [/^school|university|college/i, "school"],
  [/^degree/i, "degree"],
  [/discipline|major|field of study/i, "fieldOfStudy"],
  [/graduation year|year of graduation/i, "gradYear"],
  [/current (company|employer)/i, "currentCompany"],
  [/current (title|role|position)/i, "currentTitle"],
  [/years? of (professional )?experience/i, "yearsExperience"],
  [/legally authoriz|authoriz(ed|ation) to work|work authorization/i, "workAuthorization"],
  [/sponsorship|require.*visa/i, "requiresSponsorship"],
  [/salary|compensation expectation|expected pay/i, "salaryExpectation"],
  [/notice period/i, "noticePeriod"],
  [/earliest.*start|start date|when.*start working/i, "startDate"],
  [/resume|\bcv\b/i, "resumeFile"],
  [/cover letter|why do you want to work/i, "coverLetter"],
  [/gender/i, "gender"],
  [/\brace\b|ethnic/i, "race"],
  [/veteran/i, "veteranStatus"],
  [/disab/i, "disabilityStatus"],

  // Unambiguously NOT in the profile.
  [/consent|i agree|terms of|privacy policy/i, NO_FIELD],
  [/^search\b/i, NO_FIELD],
  [/what.?s a project|most proud of|what does .* mean|tell us about/i, NO_FIELD],
];

/**
 * Genuinely ambiguous — a deterministic rule has no business deciding these, so they
 * stay unlabelled and out of the score. Pronoun checkboxes are the example: mapping
 * them to `gender` is as defensible as calling them out of profile scope.
 */
const AMBIGUOUS = /pronoun|^(he|she|they|xe|ze|ey|hir|fae|hu)\/|use name only/i;

/** The label, or null when no rule decides it — excluded from scoring. */
export function labelFor(name: string): ProfileKey | typeof NO_FIELD | null {
  if (AMBIGUOUS.test(name)) return null;
  for (const [re, key] of RULES) if (re.test(name)) return key;
  return null;
}
