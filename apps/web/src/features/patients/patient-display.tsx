import { CheckCircle2, CircleSlash, Sparkles } from 'lucide-react';

import { StatusBadge } from '@/components/domain/status-badges';
import { ColorDot } from '@/components/forms/color-picker';
import { Avatar } from '@/components/ui/avatar';
import type {
  ConsentPurpose,
  ContactType,
  GuardianRelationship,
  PatientAge,
  PatientGender,
  PatientRecordStatus,
  PatientTherapyInterest,
  ReferralSource,
} from '@/lib/types';
import { cn } from '@/lib/utils';

/** Labels for the API's controlled values; the API's enums are the source of truth. */
export const PATIENT_STATUSES: Record<PatientRecordStatus, string> = {
  NEW: 'New',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const PATIENT_GENDERS: Record<PatientGender, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
  PREFER_NOT_TO_SAY: 'Prefer not to say',
};

export const CONTACT_TYPES: Record<ContactType, { label: string; description: string }> = {
  GUARDIAN: { label: 'Parent / guardian', description: 'A parent or legal guardian' },
  SELF: { label: 'Patient (self)', description: 'An adult who manages their own care' },
  CAREGIVER: {
    label: 'Other caregiver',
    description: 'Another authorized caregiver or contact',
  },
};

/** OTHER comes with a custom label. */
export const RELATIONSHIPS: Record<GuardianRelationship, string> = {
  FATHER: 'Father',
  MOTHER: 'Mother',
  LEGAL_GUARDIAN: 'Legal guardian',
  GRANDPARENT: 'Grandparent',
  SIBLING: 'Sibling',
  SPOUSE: 'Spouse',
  OTHER: 'Other',
};

export const REFERRAL_SOURCES: Record<ReferralSource, string> = {
  DOCTOR: 'Doctor',
  SCHOOL: 'School',
  FRIEND_FAMILY: 'Friend or family',
  SOCIAL_MEDIA: 'Social media',
  EXISTING_PATIENT: 'Existing patient',
  WALK_IN: 'Walk-in',
  OTHER: 'Other',
};

export const CONSENT_PURPOSES: Record<ConsentPurpose, { label: string; description: string }> = {
  TREATMENT: {
    label: 'Assessment & therapy',
    description: 'Agrees to assessment and therapy at the center.',
  },
  DATA_PROCESSING: {
    label: 'Personal information',
    description: 'Agrees to the center keeping and using personal and health information.',
  },
  MEDIA: {
    label: 'Photos & videos',
    description: 'Agrees to photos or videos being taken for therapy records.',
  },
};

export function relationshipLabel(c: {
  relationship: GuardianRelationship | null;
  customRelationship: string | null;
}) {
  if (!c.relationship) return null;
  return c.relationship === 'OTHER' && c.customRelationship
    ? c.customRelationship
    : RELATIONSHIPS[c.relationship];
}

/** "18 mo" under three, "5 yrs" after; approximate ages get a "~". */
export function formatPatientAge(age: PatientAge | null) {
  if (!age) return null;
  const text =
    age.years < 3
      ? `${age.years * 12 + age.months} mo`
      : `${age.years} yr${age.years === 1 ? '' : 's'}`;
  return age.isApproximate ? `~${text}` : text;
}

export function PatientAgeText({ age }: { age: PatientAge | null }) {
  const text = formatPatientAge(age);
  if (!text) return <span className="text-subtle-foreground">—</span>;
  return (
    <span className="tabular" title={age?.isApproximate ? 'Approximate age' : undefined}>
      {text}
      {age?.isApproximate && <span className="sr-only"> (approximate)</span>}
    </span>
  );
}

export function PatientStatusBadge({ status }: { status: PatientRecordStatus }) {
  return (
    <StatusBadge
      def={
        status === 'ACTIVE'
          ? { label: 'Active', tone: 'success', icon: CheckCircle2 }
          : status === 'NEW'
            ? { label: 'New', tone: 'info', icon: Sparkles }
            : { label: 'Inactive', tone: 'neutral', icon: CircleSlash }
      }
    />
  );
}

/** Therapy type chips. Inactive types are shown struck through. */
export function TherapyInterestTags({
  interests,
  full = false,
  className,
}: {
  interests: PatientTherapyInterest[];
  /** Full names instead of short codes */
  full?: boolean;
  className?: string;
}) {
  if (!interests.length) {
    return <span className="text-[13px] text-subtle-foreground">None yet</span>;
  }
  return (
    <span className={cn('flex flex-wrap gap-x-3 gap-y-1', className)}>
      {interests.map((t) => (
        <span
          key={t.therapyTypeId}
          className={cn(
            'inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap',
            !t.isActive && 'text-muted-foreground line-through',
          )}
          title={`${t.name}${t.isActive ? '' : ' (inactive)'}`}
        >
          <ColorDot color={t.color} />
          {full ? (
            t.name
          ) : (
            <>
              <span aria-hidden>{t.code}</span>
              <span className="sr-only">{t.name}</span>
            </>
          )}
        </span>
      ))}
    </span>
  );
}

/** Photo if the patient has one, else initials. */
export function PatientAvatar({
  patient,
  size = 'md',
}: {
  patient: { fullName: string; photoUrl: string | null };
  size?: 'sm' | 'md' | 'lg';
}) {
  if (!patient.photoUrl) return <Avatar name={patient.fullName} size={size} />;
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0 rounded-full bg-muted bg-cover bg-center',
        size === 'lg' ? 'size-14' : size === 'md' ? 'size-9' : 'size-7',
      )}
      style={{ backgroundImage: `url(${JSON.stringify(patient.photoUrl)})` }}
    />
  );
}
