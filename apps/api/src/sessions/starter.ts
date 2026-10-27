import type { TemplateDefinition } from '../forms/engine';

/**
 * A short, general session note to start from, for any therapy type. Centers add,
 * remove and reword its fields in Settings; goal progress isn't a form field, since it
 * comes from the patient's therapy plan (the note editor shows it before "Next plan").
 */
export const STARTER_NOTE_DEFINITION: TemplateDefinition = {
  sections: [
    {
      key: 'activities',
      title: 'Session activities',
      fields: [
        {
          key: 'activities_performed',
          type: 'TEXTAREA',
          label: 'Activities performed',
          required: true,
        },
        {
          key: 'participation',
          type: 'SINGLE_SELECT',
          label: 'Patient participation',
          required: false,
          options: [
            { value: 'good', label: 'Good' },
            { value: 'moderate', label: 'Moderate' },
            { value: 'limited', label: 'Limited' },
            { value: 'not_assessed', label: 'Not assessed' },
          ],
        },
      ],
    },
    {
      key: 'observations',
      title: 'Observations',
      fields: [
        {
          key: 'clinical_observations',
          type: 'TEXTAREA',
          label: 'Clinical observations',
          required: false,
        },
        {
          key: 'patient_response',
          type: 'TEXTAREA',
          label: 'Patient response',
          required: false,
        },
      ],
    },
    {
      key: 'next_plan',
      title: 'Next plan',
      fields: [
        {
          key: 'next_session_plan',
          type: 'TEXTAREA',
          label: 'Next session plan',
          required: false,
        },
        {
          key: 'home_guidance',
          type: 'TEXTAREA',
          label: 'Home activity / guardian guidance',
          required: false,
        },
      ],
    },
    {
      key: 'additional',
      title: 'Additional notes',
      fields: [
        {
          key: 'additional_comments',
          type: 'TEXTAREA',
          label: 'Additional comments',
          required: false,
        },
      ],
    },
  ],
};

export const STARTER_NOTE_NAME = 'Standard session note';
