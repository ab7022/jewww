/**
 * A flat profile, deliberately. Field mapping asks JEV "which profile key belongs in
 * this input?" as a single `choice`, so the key space must be flat, small, and have
 * descriptions that read like something a form label would mean.
 */
export const PROFILE_FIELDS = {
  // Whose data it is, said outright: "email address" alone matched an email's "To"
  // box, and the user's own address was typed in as the recipient.
  fullName: "the user's own full name",
  firstName: "the user's own given name only",
  lastName: "the user's own family name or surname only",
  email: "the user's own email address — never someone they are writing to",
  phone: "the user's own phone or mobile number",

  addressLine1: "street address",
  city: "city or town",
  state: "state, province, or region",
  postalCode: "ZIP or postal code",
  country: "country of residence",

  linkedin: "LinkedIn profile URL",
  github: "GitHub profile URL",
  portfolio: "personal website or portfolio URL",

  currentCompany: "the employer the candidate works for now",
  currentTitle: "the candidate's current job title",
  yearsExperience: "total years of professional experience",

  school: "university or school attended",
  degree: "degree earned, e.g. B.Tech or MSc",
  fieldOfStudy: "major or field of study",
  gradYear: "year of graduation",

  workAuthorization: "whether the candidate is legally authorised to work in the country",
  requiresSponsorship: "whether the candidate needs visa sponsorship",
  salaryExpectation: "desired or expected compensation",
  noticePeriod: "notice period or availability to start",
  startDate: "earliest date the candidate can start",

  coverLetter: "a written cover letter or 'why do you want this role' response",
  resumeFile: "a resume or CV file upload",

  gender: "EEO gender identity",
  race: "EEO race or ethnicity",
  veteranStatus: "EEO protected veteran status",
  disabilityStatus: "EEO disability status",
} as const;

export type ProfileKey = keyof typeof PROFILE_FIELDS;

/** The escape hatch. Picking this is correct behaviour, not a failure. */
export const NO_FIELD = "__none" as const;

export const NO_FIELD_DESC =
  "a question the page asks ABOUT THE USER that no saved detail answers — only the user can answer it (e.g. \"why do you want to join?\", \"years of experience\")";

/**
 * A field that is NOT a question for the user: its value comes from the request (who a
 * message goes to, the message, a subject, a search term, a quantity), or it is not a
 * form question at all (an app's own search box or editing control — Google Sheets'
 * "cell input", a menu search). Neither filled from the profile nor asked of the user;
 * the goal-aware step loop deals with it if the task needs it.
 *
 * The second half is what the mapper lacked: its only other answer for "none of your
 * details" was NO_FIELD, which means "ask the person" — so on Google Sheets they were
 * asked to type into "Menus", "cell input" and "trix offscreen".
 */
export const TASK_FIELD = "__task" as const;

export const TASK_FIELD_DESC =
  "not a question for the user — content the request itself determines (a recipient, a message or its subject, a search term, a quantity, data to enter), or an input that is part of the app rather than a form question (a search box, an editor's or spreadsheet's own input, a menu search)";

export type Profile = Partial<Record<ProfileKey, string>>;

/** Choice criteria for a field-mapping question. */
export function profileCriteria(available?: ProfileKey[]): Record<string, string> {
  const keys = available ?? (Object.keys(PROFILE_FIELDS) as ProfileKey[]);
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = PROFILE_FIELDS[k];
  out[NO_FIELD] = NO_FIELD_DESC;
  return out;
}
