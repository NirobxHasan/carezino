import type { TemplateDefinition } from '../forms/engine';

/**
 * An optional starting point for a center's own templates, deliberately general so it
 * suits any therapy service. Centers edit it like any other draft. The clinical
 * summary, recommendations and initial goals aren't here: every assessment has those as
 * structured data (see the Assessment model). Demographics and the referral source
 * aren't either: they're on the patient's registration and shown with the assessment.
 *
 * The functional ability levels are plain descriptive options, not a scoring standard.
 */
export const STARTER_DEFINITION: TemplateDefinition = {
  sections: [
    {
      key: 'general',
      title: 'General information',
      description: 'Why the patient is here and the background that matters.',
      fields: [
        {
          key: 'chief_concern',
          type: 'TEXTAREA',
          label: 'Chief concern',
          helpText: 'In the patient’s or family’s own words.',
          required: true,
        },
        {
          key: 'reason_for_assessment',
          type: 'TEXTAREA',
          label: 'Reason for assessment',
          required: false,
        },
        {
          key: 'history',
          type: 'TEXTAREA',
          label: 'Relevant developmental or medical history',
          required: false,
        },
        {
          key: 'previous_therapy',
          type: 'TEXTAREA',
          label: 'Previous therapy',
          placeholder: 'Services, where, for how long, and how it went',
          required: false,
        },
        {
          key: 'expectations',
          type: 'TEXTAREA',
          label: 'Patient or guardian expectations',
          required: false,
        },
      ],
    },
    {
      key: 'functional',
      title: 'Functional assessment',
      description:
        'Record only what was assessed. Unanswered questions are shown as not recorded.',
      fields: [
        {
          key: 'domains_assessed',
          type: 'MULTI_SELECT',
          label: 'Areas assessed',
          helpText: 'Edit this list to suit the service.',
          required: false,
          options: [
            { value: 'motor', label: 'Motor skills' },
            { value: 'sensory', label: 'Sensory processing' },
            { value: 'communication', label: 'Communication' },
            { value: 'social', label: 'Social interaction' },
            { value: 'behaviour', label: 'Behaviour' },
            { value: 'daily_living', label: 'Self-care and daily living' },
            { value: 'learning', label: 'Attention and learning' },
          ],
        },
        {
          key: 'observations',
          type: 'TEXTAREA',
          label: 'Clinical observations',
          required: false,
        },
        {
          key: 'participation',
          type: 'TEXTAREA',
          label: 'Participation during the assessment',
          required: false,
        },
        {
          key: 'functional_ability',
          type: 'SINGLE_SELECT',
          label: 'Overall functional ability',
          helpText: 'A descriptive level, not a standardized score.',
          required: false,
          options: [
            { value: 'independent', label: 'Independent' },
            {
              value: 'minimal_assistance',
              label: 'Requires minimal assistance',
            },
            {
              value: 'moderate_assistance',
              label: 'Requires moderate assistance',
            },
            {
              value: 'significant_assistance',
              label: 'Requires significant assistance',
            },
            { value: 'not_assessed', label: 'Not assessed' },
          ],
        },
        {
          key: 'additional_findings',
          type: 'TEXTAREA',
          label: 'Additional findings',
          required: false,
        },
      ],
    },
  ],
};
