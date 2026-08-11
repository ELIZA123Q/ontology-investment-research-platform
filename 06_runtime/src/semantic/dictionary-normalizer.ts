import { DOMAIN_CATALOG } from "@/src/generated/domain-catalog";

type AliasEntry = { canonical_ref: string; preferred_term: string; aliases: string[] };
type AmbiguityRule = { term: string; ambiguity: "low" | "medium" | "high"; possible_meanings: string[]; distinguish: string[]; resolution_rule: string };
type DeprecatedEntry = { deprecated_term: string; replacement: string; preferred_term_zh?: string; canonical_ref: string };

const dictionary = DOMAIN_CATALOG.dictionary as unknown as { aliases: AliasEntry[]; ambiguityRules: AmbiguityRule[]; deprecatedTerms: DeprecatedEntry[] };

export interface DictionaryNormalizationResult {
  originalText: string;
  normalizedText: string;
  canonicalRefs: string[];
  replacements: Array<{ from: string; to: string; canonicalRef: string; source: "alias" | "deprecated" }>;
  ambiguities: Array<AmbiguityRule & { matchedTerm: string }>;
}

const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function normalizeResearchLanguage(text: string): DictionaryNormalizationResult {
  let normalizedText = text;
  const canonicalRefs = new Set<string>();
  const replacements: DictionaryNormalizationResult["replacements"] = [];
  const protectedValues = new Map<string, string>();
  let protectedIndex = 0;
  const protectReplace = (from: string, to: string, canonicalRef: string, source: "alias" | "deprecated") => {
    const pattern = new RegExp(escaped(from), /[a-z]/i.test(from) ? "gi" : "g");
    let matched = false;
    normalizedText = normalizedText.replace(pattern, () => {
      matched = true;
      const token = `\uE000${protectedIndex++}\uE001`;
      protectedValues.set(token, to);
      return token;
    });
    if (!matched) return;
    canonicalRefs.add(canonicalRef);
    replacements.push({ from, to, canonicalRef, source });
  };
  for (const entry of [...dictionary.deprecatedTerms].sort((a, b) => b.deprecated_term.length - a.deprecated_term.length)) {
    const replacement = entry.preferred_term_zh || entry.replacement;
    protectReplace(entry.deprecated_term, replacement, entry.canonical_ref, "deprecated");
  }
  const aliases = dictionary.aliases.flatMap((entry) => entry.aliases.map((alias) => ({ ...entry, alias }))).sort((a, b) => b.alias.length - a.alias.length);
  for (const entry of aliases) {
    protectReplace(entry.alias, entry.preferred_term, entry.canonical_ref, "alias");
  }
  for (const [token, value] of protectedValues) normalizedText = normalizedText.replaceAll(token, value);
  const ambiguities = dictionary.ambiguityRules.flatMap((rule) => {
    const variants = rule.term.split(/\s*\/\s*/).filter(Boolean);
    const matchedTerm = variants.find((term) => normalizedText.includes(term));
    return matchedTerm ? [{ ...rule, matchedTerm }] : [];
  });
  return { originalText: text, normalizedText, canonicalRefs: [...canonicalRefs], replacements, ambiguities };
}
