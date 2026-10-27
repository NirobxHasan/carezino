import type { Metadata } from 'next';

import { NoteTemplatesScreen } from '@/features/settings/session-note-templates/templates-screen';

export const metadata: Metadata = { title: 'Session note templates' };

export default function Page() {
  return <NoteTemplatesScreen />;
}
