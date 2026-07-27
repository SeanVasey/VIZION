import {
  DEVELOPER_LABEL,
  DEVELOPER_ORDER,
  TARGET_MODELS,
  type Developer,
} from "@/lib/constants";

/** A model facet as the library query returns it: an id the user's own
 *  prompts actually use, with how many use it. */
export interface ModelFacet {
  id: string;
  count: number;
}

export interface FacetModel extends ModelFacet {
  label: string;
  developer: Developer | null;
}

export interface FacetGroup {
  /** null for ids no longer in the roster — see the "Other" note below. */
  developer: Developer | null;
  label: string;
  models: FacetModel[];
}

const META = new Map(TARGET_MODELS.map((m) => [m.id, m]));

/**
 * Group the library's model facets under developer headers.
 *
 * Returns `null` when grouping would add nothing — a library whose prompts all
 * come from one developer gets headers that say the same thing twice, so the
 * caller keeps the flat chip row. Making that a return value rather than a
 * boolean the caller has to remember to check keeps the rule in one place.
 *
 * Within a group the query's own order is preserved (count-descending), so
 * "the model I use most" stays first where the user expects it; only the
 * grouping is added. Developers are in DEVELOPER_ORDER, the same locked order
 * the roster and the target picker use.
 *
 * An id with no roster entry still gets a chip: a model renamed away leaves
 * real saved prompts behind, and hiding their facet would make them
 * unfilterable. They collect under "Other", last.
 */
export function groupModelFacets(models: ModelFacet[]): FacetGroup[] | null {
  const decorated: FacetModel[] = models.map((m) => {
    const meta = META.get(m.id as (typeof TARGET_MODELS)[number]["id"]);
    return {
      ...m,
      label: meta?.label ?? m.id,
      developer: meta?.developer ?? null,
    };
  });

  const byDeveloper = new Map<Developer, FacetModel[]>();
  const orphans: FacetModel[] = [];
  for (const m of decorated) {
    if (m.developer === null) {
      orphans.push(m);
      continue;
    }
    const bucket = byDeveloper.get(m.developer);
    if (bucket) bucket.push(m);
    else byDeveloper.set(m.developer, [m]);
  }

  const groups: FacetGroup[] = [];
  for (const developer of DEVELOPER_ORDER) {
    const bucket = byDeveloper.get(developer);
    if (bucket) {
      groups.push({ developer, label: DEVELOPER_LABEL[developer], models: bucket });
    }
  }
  if (orphans.length > 0) {
    groups.push({ developer: null, label: "Other", models: orphans });
  }

  return groups.length > 1 ? groups : null;
}
