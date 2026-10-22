import {
  changedAnswerLabels,
  defaultAnswers,
  parseDefinition,
  typeChanges,
  validateAnswers,
  type TemplateDefinition,
} from './engine';
import { STARTER_DEFINITION } from './starter';

function form(fields: object[], extra: object = {}) {
  return { sections: [{ key: 'main', title: 'Main', fields, ...extra }] };
}

function parsed(input: unknown, forPublish = false): TemplateDefinition {
  const result = parseDefinition(input, { forPublish });
  if (result.errors) throw new Error(JSON.stringify(result.errors));
  return result.definition;
}

function errorsOf(input: unknown, forPublish = false) {
  return parseDefinition(input, { forPublish }).errors ?? {};
}

const choice = (key: string, type = 'SINGLE_SELECT', extra: object = {}) => ({
  key,
  type,
  label: key,
  required: false,
  options: [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
    { value: 'sometimes', label: 'Sometimes' },
  ],
  ...extra,
});

describe('parseDefinition', () => {
  it('accepts the starter form as published', () => {
    expect(parsed(STARTER_DEFINITION, true)).toEqual(STARTER_DEFINITION);
  });

  it('accepts every supported field type', () => {
    const d = parsed(
      form([
        { key: 'a', type: 'TEXT', label: 'A', required: true },
        { key: 'b', type: 'TEXTAREA', label: 'B' },
        {
          key: 'c',
          type: 'NUMBER',
          label: 'C',
          validation: { min: 0, max: 10, integer: true },
        },
        choice('d'),
        choice('e', 'MULTI_SELECT', { validation: { maxSelections: 2 } }),
        choice('f', 'RADIO'),
        { key: 'g', type: 'CHECKBOX', label: 'G' },
        { key: 'h', type: 'DATE', label: 'H' },
      ]),
      true,
    );
    expect(d.sections[0].fields.map((f) => f.type)).toEqual([
      'TEXT',
      'TEXTAREA',
      'NUMBER',
      'SINGLE_SELECT',
      'MULTI_SELECT',
      'RADIO',
      'CHECKBOX',
      'DATE',
    ]);
    // Optional is the default and labels are trimmed.
    expect(d.sections[0].fields[1].required).toBe(false);
  });

  it('rejects unsupported field types', () => {
    expect(
      errorsOf(form([{ key: 'x', type: 'SIGNATURE', label: 'X' }])),
    ).toEqual({
      'definition.sections.0.fields.0.type': 'Choose a supported field type',
    });
    expect(
      errorsOf(form([{ key: 'x', type: 'script', label: 'X' }])),
    ).toHaveProperty(['definition.sections.0.fields.0.type']);
  });

  it('rejects unknown settings instead of storing them', () => {
    const errors = errorsOf(
      form([{ key: 'x', type: 'TEXT', label: 'X', onChange: 'alert(1)' }]),
    );
    expect(errors['definition.sections.0.fields.0.onChange']).toBe(
      'Unknown setting',
    );
    expect(errorsOf({ sections: [], html: '<b>' })['definition.html']).toBe(
      'Unknown setting',
    );
  });

  it('checks select options', () => {
    const at = 'definition.sections.0.fields.0.options';
    expect(errorsOf(form([{ key: 'x', type: 'RADIO', label: 'X' }]))[at]).toBe(
      'Add at least 2 options',
    );
    expect(
      errorsOf(
        form([choice('x', 'RADIO', { options: [{ value: 'a', label: 'A' }] })]),
      )[at],
    ).toBe('Add at least 2 options');
    expect(
      errorsOf(
        form([
          choice('x', 'RADIO', {
            options: [
              { value: 'a', label: 'A' },
              { value: 'a', label: 'B' },
            ],
          }),
        ]),
      )[`${at}.1.value`],
    ).toBe('Each option needs its own value');
    expect(
      errorsOf(
        form([
          choice('x', 'RADIO', {
            options: [
              { value: 'A B', label: 'A' },
              { value: 'b', label: 'B' },
            ],
          }),
        ]),
      )[`${at}.0.value`],
    ).toBeDefined();
    expect(
      errorsOf(form([{ key: 'x', type: 'TEXT', label: 'X', options: [] }]))[at],
    ).toBe('Only choice fields have options');
  });

  it('needs unique, well-formed field identifiers', () => {
    const errors = errorsOf(
      form([
        { key: 'same', type: 'TEXT', label: 'One' },
        { key: 'same', type: 'TEXT', label: 'Two' },
        { key: '__proto__', type: 'TEXT', label: 'Three' },
      ]),
    );
    expect(errors['definition.sections.0.fields.1.key']).toBe(
      'Another field already uses this identifier',
    );
    expect(errors['definition.sections.0.fields.2.key']).toBeDefined();
  });

  it('checks limits and defaults against the field type', () => {
    expect(
      errorsOf(
        form([
          {
            key: 'n',
            type: 'NUMBER',
            label: 'N',
            validation: { min: 5, max: 1 },
          },
        ]),
      )['definition.sections.0.fields.0.validation.min'],
    ).toBe('Must not be more than the maximum');
    expect(
      errorsOf(
        form([{ key: 't', type: 'TEXT', label: 'T', validation: { min: 1 } }]),
      )['definition.sections.0.fields.0.validation.min'],
    ).toBeDefined();
    expect(
      errorsOf(form([choice('s', 'SINGLE_SELECT', { defaultValue: 'maybe' })]))[
        'definition.sections.0.fields.0.defaultValue'
      ],
    ).toBe('Choose one of the options');
    expect(
      parsed(form([choice('s', 'SINGLE_SELECT', { defaultValue: 'no' })]))
        .sections[0].fields[0].defaultValue,
    ).toBe('no');
  });

  it('lets drafts be unfinished but not published that way', () => {
    expect(parsed({ sections: [] })).toEqual({ sections: [] });
    expect(
      errorsOf({ sections: [] }, true)['definition.sections'],
    ).toBeDefined();
    expect(errorsOf(form([]), true)['definition.sections.0.fields']).toBe(
      'Add at least one field, or remove this section',
    );
  });
});

describe('typeChanges', () => {
  it('stops a kept field from changing type between versions', () => {
    const v1 = parsed(form([{ key: 'score', type: 'NUMBER', label: 'Score' }]));
    const v2 = parsed(form([{ key: 'score', type: 'TEXT', label: 'Score' }]));
    const v3 = parsed(form([{ key: 'score2', type: 'TEXT', label: 'Score' }]));
    expect(Object.keys(typeChanges(v2, [v1]))).toEqual([
      'definition.sections.0.fields.0.type',
    ]);
    expect(typeChanges(v3, [v1])).toEqual({});
  });
});

describe('validateAnswers', () => {
  const definition = parsed(
    form([
      {
        key: 'concern',
        type: 'TEXTAREA',
        label: 'Chief concern',
        required: true,
      },
      {
        key: 'note',
        type: 'TEXT',
        label: 'Note',
        validation: { maxLength: 5 },
      },
      {
        key: 'count',
        type: 'NUMBER',
        label: 'Count',
        validation: { integer: true, min: 0 },
      },
      choice('ability'),
      choice('areas', 'MULTI_SELECT'),
      { key: 'seen', type: 'CHECKBOX', label: 'Seen' },
      { key: 'on', type: 'DATE', label: 'On' },
    ]),
  );

  it('accepts valid answers and drops empty ones', () => {
    const { answers, errors } = validateAnswers(definition, {
      concern: '  Not talking yet ',
      note: '',
      count: 3,
      ability: 'sometimes',
      areas: ['no', 'yes'],
      seen: false,
      on: '2026-10-20',
    });
    expect(errors).toBeNull();
    // Multi-select answers are kept in the form's order.
    expect(answers).toEqual({
      concern: 'Not talking yet',
      count: 3,
      ability: 'sometimes',
      areas: ['yes', 'no'],
      on: '2026-10-20',
    });
  });

  it('lets drafts skip required fields but not completion', () => {
    expect(validateAnswers(definition, {}).errors).toBeNull();
    expect(validateAnswers(definition, {}, { complete: true }).errors).toEqual({
      'answers.concern': 'Chief concern is required',
    });
  });

  it('rejects unknown fields and answers of the wrong kind', () => {
    const { errors } = validateAnswers(definition, {
      diagnosis: 'x',
      count: '3',
      ability: 'maybe',
      areas: 'yes',
      seen: 'true',
      on: '2026-02-30',
      note: 'too long',
    });
    expect(errors).toEqual({
      'answers.diagnosis': 'This question isn’t part of the form',
      'answers.count': 'Enter a number',
      'answers.ability': 'Choose one of the options',
      'answers.areas': 'Choose from the options',
      'answers.seen': 'Check or uncheck the box',
      'answers.on': 'Choose a valid date',
      'answers.note': 'Use up to 5 characters',
    });
    expect(validateAnswers(definition, { count: 1.5 }).errors).toEqual({
      'answers.count': 'Enter a whole number',
    });
    expect(validateAnswers(definition, ['x']).errors).toEqual({
      answers: 'Invalid answers',
    });
  });

  it('keeps answers when the template changes, since each version is its own form', () => {
    const v2 = parsed(
      form([{ key: 'concern', type: 'TEXTAREA', label: 'Main concern' }]),
    );
    // An answer to a field v2 dropped is still valid against v1, the version it used.
    expect(validateAnswers(definition, { count: 2 }).errors).toBeNull();
    expect(validateAnswers(v2, { count: 2 }).errors).toEqual({
      'answers.count': 'This question isn’t part of the form',
    });
  });
});

describe('defaults and changes', () => {
  it('starts new assessments with the template’s defaults', () => {
    const d = parsed(
      form([
        choice('a', 'RADIO', { defaultValue: 'yes' }),
        { key: 'b', type: 'TEXT', label: 'B' },
      ]),
    );
    expect(defaultAnswers(d)).toEqual({ a: 'yes' });
  });

  it('names the fields whose answers changed', () => {
    const d = parsed(
      form([
        { key: 'a', type: 'TEXT', label: 'First' },
        { key: 'b', type: 'TEXT', label: 'Second' },
      ]),
    );
    expect(
      changedAnswerLabels(d, { a: 'x', b: 'y' }, { a: 'x', b: 'z' }),
    ).toEqual(['Second']);
  });
});
