import type { FormTemplate } from '../types';

/**
 * Prototype form templates. In production these come from the API and are edited in
 * Settings → Templates; the shapes here are exactly what the renderer consumes.
 */

const domainOptions = [
  { value: 'fine_motor', label: 'Fine motor' },
  { value: 'gross_motor', label: 'Gross motor' },
  { value: 'sensory', label: 'Sensory processing' },
  { value: 'self_care', label: 'Self-care / ADL' },
  { value: 'communication', label: 'Communication' },
  { value: 'behavior', label: 'Behaviour' },
  { value: 'social', label: 'Social interaction' },
  { value: 'cognition', label: 'Cognition & play' },
];

const levelOptions = [
  { value: 'age_appropriate', label: 'Age appropriate' },
  { value: 'mild', label: 'Mild difficulty' },
  { value: 'moderate', label: 'Moderate difficulty' },
  { value: 'severe', label: 'Severe difficulty' },
];

export const seedTemplates = (now: string): FormTemplate[] => [
  {
    id: 'tpl_assess_general',
    kind: 'assessment',
    name: 'Initial developmental assessment',
    therapyTypeIds: [],
    version: 3,
    status: 'published',
    updatedAt: now,
    sections: [
      {
        id: 'general',
        title: 'General information',
        description: 'Why the family is here and what led to the referral.',
        fields: [
          {
            id: 'assessment_type',
            label: 'Assessment type',
            type: 'radio',
            required: true,
            options: [
              { value: 'initial', label: 'Initial' },
              { value: 'review', label: 'Progress review' },
              { value: 'discharge', label: 'Discharge' },
            ],
          },
          {
            id: 'referral_source',
            label: 'Referral source',
            type: 'select',
            width: 'half',
            options: [
              { value: 'self', label: 'Parent / self-referred' },
              { value: 'pediatrician', label: 'Pediatrician' },
              { value: 'neurologist', label: 'Neurologist' },
              { value: 'school', label: 'School' },
              { value: 'other', label: 'Other' },
            ],
          },
          {
            id: 'referral_other',
            label: 'Referred by',
            type: 'text',
            width: 'half',
            placeholder: 'Name of person or organisation',
            showIf: { fieldId: 'referral_source', in: ['other', 'pediatrician', 'neurologist'] },
          },
          {
            id: 'primary_concern',
            label: 'Primary concern',
            type: 'textarea',
            required: true,
            placeholder: 'In the family’s words, what are they most concerned about?',
          },
          {
            id: 'history',
            label: 'Developmental and relevant history',
            type: 'textarea',
            optional: true,
            helpText: 'Birth history, milestones, medical conditions, previous therapy.',
          },
          {
            id: 'previous_therapy',
            label: 'Has received therapy before',
            type: 'checkbox',
            optional: true,
          },
          {
            id: 'previous_therapy_details',
            label: 'Previous therapy details',
            type: 'text',
            optional: true,
            showIf: { fieldId: 'previous_therapy', in: [true] },
          },
        ],
      },
      {
        id: 'functional',
        title: 'Functional assessment',
        description: 'Pick the domains you assessed. Related fields appear as you select them.',
        fields: [
          {
            id: 'domains',
            label: 'Assessment domains',
            type: 'multiselect',
            required: true,
            options: domainOptions,
          },
          {
            id: 'motor_level',
            label: 'Motor skills',
            type: 'select',
            width: 'half',
            options: levelOptions,
            showIf: { fieldId: 'domains', in: ['fine_motor', 'gross_motor'] },
          },
          {
            id: 'sensory_observations',
            label: 'Sensory processing observations',
            type: 'textarea',
            showIf: { fieldId: 'domains', in: ['sensory'] },
            placeholder: 'Seeking / avoiding patterns, regulation, response to input',
          },
          {
            id: 'receptive_language',
            label: 'Receptive language',
            type: 'select',
            width: 'half',
            options: levelOptions,
            showIf: { fieldId: 'domains', in: ['communication'] },
          },
          {
            id: 'expressive_language',
            label: 'Expressive language',
            type: 'select',
            width: 'half',
            options: levelOptions,
            showIf: { fieldId: 'domains', in: ['communication'] },
          },
          {
            id: 'target_behaviors',
            label: 'Behaviours of concern',
            type: 'textarea',
            showIf: { fieldId: 'domains', in: ['behavior'] },
            placeholder: 'Describe frequency, triggers and current responses',
          },
          {
            id: 'observations',
            label: 'Clinical observations',
            type: 'textarea',
            required: true,
          },
          {
            id: 'functional_ability',
            label: 'Overall functional ability',
            type: 'radio',
            options: [
              { value: 'independent', label: 'Independent' },
              { value: 'needs_some_support', label: 'Needs some support' },
              { value: 'needs_substantial_support', label: 'Needs substantial support' },
            ],
          },
          { id: 'strengths', label: 'Strengths', type: 'textarea', width: 'half' },
          {
            id: 'difficulties',
            label: 'Areas of difficulty',
            type: 'textarea',
            width: 'half',
          },
        ],
      },
      {
        id: 'summary',
        title: 'Clinical summary',
        description: 'Your recommendation. Carezino never suggests a diagnosis.',
        fields: [
          { id: 'summary', label: 'Assessment summary', type: 'textarea', required: true },
          {
            id: 'recommended_therapy',
            label: 'Recommended therapy',
            type: 'multiselect',
            required: true,
            options: [
              { value: 'tt_ot', label: 'Occupational therapy' },
              { value: 'tt_aba', label: 'Applied behaviour analysis' },
              { value: 'tt_slt', label: 'Speech & language therapy' },
            ],
          },
          {
            id: 'frequency',
            label: 'Suggested frequency',
            type: 'select',
            width: 'half',
            options: [
              { value: '1', label: '1 session / week' },
              { value: '2', label: '2 sessions / week' },
              { value: '3', label: '3 sessions / week' },
              { value: '5', label: '5 sessions / week' },
            ],
          },
          {
            id: 'follow_up_date',
            label: 'Follow-up review',
            type: 'date',
            width: 'half',
          },
          {
            id: 'initial_goals',
            label: 'Initial therapy goals',
            type: 'textarea',
            helpText: 'One goal per line. They become trackable goals on the therapy plan.',
          },
        ],
      },
    ],
  },
  {
    id: 'tpl_assess_slt',
    kind: 'assessment',
    name: 'Speech & language screening',
    therapyTypeIds: ['tt_slt'],
    version: 1,
    status: 'published',
    updatedAt: now,
    sections: [
      {
        id: 'screening',
        title: 'Screening',
        fields: [
          { id: 'primary_concern', label: 'Primary concern', type: 'textarea', required: true },
          {
            id: 'languages_at_home',
            label: 'Languages used at home',
            type: 'multiselect',
            options: [
              { value: 'bn', label: 'Bangla' },
              { value: 'en', label: 'English' },
              { value: 'other', label: 'Other' },
            ],
          },
          {
            id: 'intelligibility',
            label: 'Speech intelligibility to unfamiliar listeners',
            type: 'radio',
            options: [
              { value: 'high', label: 'Mostly understood' },
              { value: 'medium', label: 'Partly understood' },
              { value: 'low', label: 'Rarely understood' },
            ],
          },
          { id: 'summary', label: 'Summary and recommendation', type: 'textarea', required: true },
        ],
      },
    ],
  },
  {
    id: 'tpl_note_ot',
    kind: 'session_note',
    name: 'OT session extras',
    therapyTypeIds: ['tt_ot'],
    version: 2,
    status: 'published',
    updatedAt: now,
    sections: [
      {
        id: 'extras',
        title: 'Occupational therapy',
        fields: [
          {
            id: 'regulation_strategies',
            label: 'Regulation strategies used',
            type: 'multiselect',
            options: [
              { value: 'heavy_work', label: 'Heavy work' },
              { value: 'swing', label: 'Swing / vestibular' },
              { value: 'deep_pressure', label: 'Deep pressure' },
              { value: 'visual_schedule', label: 'Visual schedule' },
              { value: 'breaks', label: 'Movement breaks' },
            ],
          },
          { id: 'home_program', label: 'Home program given', type: 'checkbox' },
        ],
      },
    ],
  },
  {
    id: 'tpl_note_aba',
    kind: 'session_note',
    name: 'ABA session data',
    therapyTypeIds: ['tt_aba'],
    version: 1,
    status: 'published',
    updatedAt: now,
    sections: [
      {
        id: 'extras',
        title: 'Trial data',
        fields: [
          { id: 'trials_correct', label: 'Correct trials', type: 'number', width: 'half', min: 0 },
          { id: 'trials_total', label: 'Total trials', type: 'number', width: 'half', min: 0 },
          {
            id: 'prompt_level',
            label: 'Highest prompt level used',
            type: 'select',
            width: 'half',
            options: [
              { value: 'independent', label: 'Independent' },
              { value: 'gestural', label: 'Gestural' },
              { value: 'verbal', label: 'Verbal' },
              { value: 'partial_physical', label: 'Partial physical' },
              { value: 'full_physical', label: 'Full physical' },
            ],
          },
          { id: 'incident', label: 'Behaviour incident occurred', type: 'checkbox' },
          {
            id: 'incident_details',
            label: 'Incident details',
            type: 'textarea',
            showIf: { fieldId: 'incident', in: [true] },
          },
        ],
      },
    ],
  },
  {
    id: 'tpl_note_slt',
    kind: 'session_note',
    name: 'SLT session extras',
    therapyTypeIds: ['tt_slt'],
    version: 1,
    status: 'published',
    updatedAt: now,
    sections: [
      {
        id: 'extras',
        title: 'Speech & language',
        fields: [
          { id: 'targets', label: 'Sound / language targets', type: 'text', width: 'half' },
          {
            id: 'accuracy',
            label: 'Accuracy (%)',
            type: 'number',
            width: 'half',
            min: 0,
            max: 100,
          },
        ],
      },
    ],
  },
];
