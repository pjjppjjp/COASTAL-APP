/**
 * Research context and a field-survey checklist for the COASTAL planner.
 * The checklist records declared observations. It is not a validated habitat
 * suitability model, and neither species choice nor checklist completion
 * supplies an optimal spacing, a survival estimate, or device validation.
 */

const SOURCE = Object.freeze({
  short: 'https://doi.org/10.3354/meps227253',
  cossa: 'https://doi.org/10.1111/rec.14382',
  williams: 'https://doi.org/10.1073/pnas.1707962114',
  adhavan: 'https://doi.org/10.1007/s11852-022-00863-6',
  temmink: 'https://doi.org/10.1038/s41467-020-17438-4',
  dmcr: 'https://www.dmcr.go.th/detailLib/713/',
  identification: 'https://www.seagrasswatch.org/wp-content/uploads/ID_Seagrass/pdf/Lanyon_1986.pdf',
});

export const SPECIES = Object.freeze([
  Object.freeze({
    id: 'ovalis',
    common: 'Spoon grass',
    latin: 'Halophila ovalis',
    tag: 'Oval leaves',
    description: 'Small, oval leaves on a creeping rhizome. Included in restoration trials in Indonesia and India; confirm local occurrence before choosing this species.',
    evidence: Object.freeze([SOURCE.williams, SOURCE.adhavan, SOURCE.identification]),
  }),
  Object.freeze({
    id: 'uninervis',
    common: 'Narrowleaf seagrass',
    latin: 'Halodule uninervis',
    tag: 'Ribbon leaves',
    description: 'Slender, flat leaves with a distinctive trident tip. Planting methods and densities have been tested in Mozambique; local conditions still determine a trial design.',
    evidence: Object.freeze([SOURCE.cossa, SOURCE.williams, SOURCE.identification]),
  }),
  Object.freeze({
    id: 'pinifolia',
    common: 'Needle seagrass',
    latin: 'Halodule pinifolia',
    tag: 'Fine leaves',
    description: 'Fine, flat leaves with rounded tips. A Thai study documents transplantation in Makampom Bay; no numerical spacing recommendation is taken from that record.',
    evidence: Object.freeze([SOURCE.dmcr, SOURCE.identification]),
  }),
]);

export const EVIDENCE = Object.freeze([
  {
    title: 'Site-selection model for optimal transplantation of eelgrass Zostera marina in the northeastern US',
    authors: 'Short et al.',
    year: 2002,
    url: SOURCE.short,
    implication: 'Supports staged screening, field observations, and test transplants. This temperate eelgrass study does not establish suitability thresholds for tropical species.',
  },
  {
    title: 'Restoring Halodule uninervis: evaluating planting methods and biodiversity',
    authors: 'Cossa et al.',
    year: 2025,
    url: SOURCE.cossa,
    implication: 'A Mozambique field experiment tested plugs, single shoots, and planting density. Its shoot densities are not COASTAL structure densities or universal spacing recommendations.',
  },
  {
    title: 'Species richness accelerates marine ecosystem restoration in the Coral Triangle',
    authors: 'Williams, Ambo-Rappe, Sur, Abbott & Limbong',
    year: 2017,
    url: SOURCE.williams,
    implication: 'An Indonesian experiment, including H. ovalis and H. uninervis, found benefits from species mixtures. Local native composition and field conditions still require assessment.',
  },
  {
    title: 'Diversity of seagrasses and site-specific strategy for their restoration in Gulf of Kachchh Marine National Park—Gujarat, India',
    authors: 'Adhavan, Chandran & Sivakumar',
    year: 2022,
    url: SOURCE.adhavan,
    implication: 'Site surveys and anchoring trials included H. ovalis and H. uninervis. The work supports adapting restoration methods to local sediment, tides, and water conditions.',
  },
  {
    title: 'Mimicry of emergent traits amplifies coastal restoration success',
    authors: 'Temmink et al.',
    year: 2020,
    url: SOURCE.temmink,
    implication: 'Experiments support testing structures that mimic protective vegetation traits. This research does not validate COASTAL hardware or its claimed performance.',
  },
  {
    title: 'Transplantation of seagrass, Halodule pinifolia (MIKI) DEN HARTOG: survival between mangrove and urban areas in Makampom Bay, Rayong Province, Thailand',
    authors: 'Wutthivorawong, Boonyanate, Polpool & Suwannachote · Thailand DMCR',
    year: 2011,
    url: SOURCE.dmcr,
    implication: 'An official Thai research report documents local transplantation work. The available record does not justify a numerical spacing recommendation or predicted survival.',
  },
].map(Object.freeze));

export const SURVEY_FIELDS = Object.freeze([
  {
    id: 'native',
    label: 'Native species confirmed',
    help: 'Field identification and local records confirm that the selected species occurs naturally here, or occurred here historically. Confirm its identity before marking Yes.',
  },
  {
    id: 'stressors',
    label: 'Drivers of seagrass loss addressed',
    help: 'Survey findings and site history show that the main causes of loss, such as poor water quality, anchoring, or erosion, have been removed or controlled.',
  },
  {
    id: 'sediment',
    label: 'Sediment supports establishment',
    help: 'A field assessment confirms compatible rooting sediment without persistent erosion or burial. Assess this for the selected species and planting method.',
  },
  {
    id: 'light',
    label: 'Light and water conditions checked',
    help: 'Measurements at planting depth, including water clarity and relevant seasonal variation, support a local trial for the selected species.',
  },
  {
    id: 'exposure',
    label: 'Depth, tides and exposure checked',
    help: 'Field measurements of depth, tidal exposure, waves, and currents support a trial of the proposed planting method and structure under local conditions.',
  },
  {
    id: 'habitat',
    label: 'Sensitive habitats excluded',
    help: 'A field survey has mapped existing seagrass meadow, coral, and other sensitive habitat. Exclude these areas from the planting boundary or mark them as exclusion zones.',
  },
].map(Object.freeze));

const CHECKLIST_NOTE = 'Checklist only; no validated suitability model is applied.';

/**
 * Summarize six declared field checks without assigning a suitability score.
 * Only an own property with the exact value "yes" is favorable. "no" records
 * a constraint; missing, "unknown", and unrecognized values remain unknown.
 * Unrecognized survey keys are ignored. Input is never modified.
 *
 * @param {Record<string, 'unknown'|'yes'|'no'>} [survey]
 * @returns {{status: 'survey'|'review'|'pilot', title: string, summary: string,
 *   constraints: string[], unknownCount: number, verifiedCount: number}}
 */
export function assessSurvey(survey = {}) {
  const values = survey !== null && typeof survey === 'object' && !Array.isArray(survey)
    ? survey
    : {};
  const constraints = [];
  let unknownCount = 0;
  let verifiedCount = 0;

  for (const field of SURVEY_FIELDS) {
    const answer = Object.prototype.hasOwnProperty.call(values, field.id)
      ? values[field.id]
      : 'unknown';
    if (answer === 'yes') verifiedCount++;
    else if (answer === 'no') constraints.push(field.label);
    else unknownCount++;
  }

  const counts = { constraints, unknownCount, verifiedCount };
  if (constraints.length > 0) {
    return {
      status: 'review',
      title: 'Resolve site constraints',
      summary: `Resolve the flagged field constraints and any outstanding checks before a pilot. ${CHECKLIST_NOTE}`,
      ...counts,
    };
  }
  if (unknownCount > 0) {
    return {
      status: 'survey',
      title: 'Field survey needed',
      summary: `Complete ${unknownCount} outstanding field ${unknownCount === 1 ? 'check' : 'checks'} before selecting a pilot site. ${CHECKLIST_NOTE}`,
      ...counts,
    };
  }
  return {
    status: 'pilot',
    title: 'Candidate for monitored pilot',
    summary: `All field checks are marked favorable. Confirm a local trial design and monitor establishment before scaling up. ${CHECKLIST_NOTE}`,
    ...counts,
  };
}
