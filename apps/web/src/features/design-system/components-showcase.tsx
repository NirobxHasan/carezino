'use client';

import * as React from 'react';
import { format, subDays } from 'date-fns';
import { CalendarDays, Ellipsis, Pencil, Plus, Trash2, Users } from 'lucide-react';

import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { FilterBar, SearchInput } from '@/components/data-table/filter-bar';
import {
  AppointmentStatusBadge,
  InvoiceStatusBadge,
  NoteStatusBadge,
  PatientStatusBadge,
  PaymentStatusBadge,
} from '@/components/domain/status-badges';
import { KpiCard } from '@/components/domain/kpi-card';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState, ErrorState, InlineLoader, ListSkeleton } from '@/components/feedback/states';
import { DatePicker, DateRangePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { MultiSelect, SearchableSelect } from '@/components/forms/searchable-select';
import { TimePicker } from '@/components/forms/time-picker';
import { SectionHeader } from '@/components/layout/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioCard, RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import {
  SegmentedList,
  SegmentedTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatTaka } from '@/lib/format';

// Isolated preview data for this page only.
const therapistOptions = [
  { value: 'th_1', label: 'Farhana Rahman', description: 'Occupational therapist' },
  { value: 'th_3', label: 'Nusrat Jahan', description: 'Speech & language therapist' },
  { value: 'th_5', label: 'Mahmudul Hasan', description: 'Behaviour analyst (BCBA)' },
  { value: 'th_8', label: 'Shirin Sultana', description: 'On leave', disabled: true },
].map((o) => ({ ...o, leading: <Avatar name={o.label} size="sm" /> }));

const therapyOptions = [
  { value: 'ot', label: 'Occupational therapy' },
  { value: 'aba', label: 'Applied behaviour analysis' },
  { value: 'slt', label: 'Speech & language therapy' },
];

interface SampleInvoice {
  number: string;
  patient: string;
  amount: number;
  status: 'paid' | 'partial' | 'unpaid' | 'overdue';
}

const sampleInvoices: SampleInvoice[] = [
  { number: 'INV-2610-0141', patient: 'Ayaan Rahman', amount: 15000, status: 'paid' },
  { number: 'INV-2610-0142', patient: 'Zara Karim', amount: 14400, status: 'partial' },
  { number: 'INV-2610-0143', patient: 'Raisa Chowdhury', amount: 36000, status: 'overdue' },
  { number: 'INV-2610-0144', patient: 'Tahmid Hossain', amount: 4200, status: 'unpaid' },
  { number: 'INV-2610-0145', patient: 'Nabila Islam', amount: 1500, status: 'paid' },
  { number: 'INV-2610-0146', patient: 'Farhan Ahmed', amount: 10800, status: 'paid' },
];

function Demo({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function ComponentsShowcase() {
  const [date, setDate] = React.useState<string>();
  const [time, setTime] = React.useState<string>('10:30');
  const [range, setRange] = React.useState(() => ({
    from: format(subDays(new Date(), 6), 'yyyy-MM-dd'),
    to: format(new Date(), 'yyyy-MM-dd'),
  }));
  const [therapist, setTherapist] = React.useState<string>();
  const [therapies, setTherapies] = React.useState<string[]>(['ot']);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const columns = React.useMemo<ColumnDef<SampleInvoice, unknown>[]>(
    () => [
      { accessorKey: 'number', header: 'Invoice', meta: { className: 'tabular' } },
      { accessorKey: 'patient', header: 'Patient', enableSorting: true },
      {
        accessorKey: 'amount',
        header: 'Amount',
        enableSorting: true,
        meta: { className: 'text-right tabular' },
        cell: ({ getValue }) => formatTaka(getValue() as number),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        enableSorting: false,
        cell: ({ getValue }) => (
          <InvoiceStatusBadge status={getValue() as SampleInvoice['status']} />
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: 'w-12 text-right' },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${row.original.number}`}
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem tone="danger">
                <Trash2 /> Void invoice
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [],
  );

  const rows = sampleInvoices.filter((r) =>
    `${r.number} ${r.patient}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-10">
      <section>
        <SectionHeader
          title="Actions"
          description="One primary action per area. Secondary for the rest."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <Demo title="Buttons" description="primary · secondary · ghost · subtle · danger · link">
            <div className="flex flex-wrap items-center gap-2">
              <Button>
                <Plus /> Book appointment
              </Button>
              <Button variant="secondary">Register patient</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="subtle">Add goal</Button>
              <Button variant="danger">Delete</Button>
              <Button variant="link">View all</Button>
            </div>
          </Demo>
          <Demo title="Sizes and states" description="sm 32px · md 40px · lg 44px">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm">Small</Button>
              <Button>Medium</Button>
              <Button size="lg">Large</Button>
              <Button loading>Saving</Button>
              <Button disabled>Disabled</Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="secondary" size="icon" aria-label="Calendar">
                    <CalendarDays />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Icon buttons always get a tooltip</TooltipContent>
              </Tooltip>
            </div>
          </Demo>
        </div>
      </section>

      <section>
        <SectionHeader
          title="Inputs"
          description="Labels above inputs, a red asterisk for required fields, and errors written inline."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <Demo title="Text">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Patient name" required>
                <Input placeholder="Full name" />
              </Field>
              <Field
                label="Guardian phone"
                required
                error="Enter an 11-digit mobile number, e.g. 01712-345678"
              >
                <Input defaultValue="0171234" inputMode="tel" />
              </Field>
              <Field label="School" optional helper="Helps therapists plan school-related goals.">
                <Input placeholder="e.g. Scholastica" />
              </Field>
              <Field label="Disabled">
                <Input disabled defaultValue="CZ-1042" />
              </Field>
              <Field label="Observations" className="sm:col-span-2">
                <Textarea placeholder="What did you notice during the session?" />
              </Field>
            </div>
          </Demo>
          <Demo title="Selection">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Gender">
                <Select defaultValue="female">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="female">Girl</SelectItem>
                    <SelectItem value="male">Boy</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="Therapist"
                helper="Searchable; unavailable people stay visible but disabled."
              >
                <SearchableSelect
                  options={therapistOptions}
                  value={therapist}
                  onChange={setTherapist}
                  placeholder="Select therapist"
                />
              </Field>
              <Field label="Therapy types" className="sm:col-span-2">
                <MultiSelect options={therapyOptions} value={therapies} onChange={setTherapies} />
              </Field>
              <div className="flex items-center gap-2">
                <Checkbox id="ds-consent" defaultChecked />
                <Label htmlFor="ds-consent" className="font-normal">
                  Guardian consent recorded
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="ds-sms" defaultChecked />
                <Label htmlFor="ds-sms" className="font-normal">
                  SMS reminders
                </Label>
              </div>
              <RadioGroup defaultValue="good" className="sm:col-span-2" aria-label="Participation">
                <div className="flex flex-wrap gap-4">
                  {['Excellent', 'Good', 'Fair', 'Poor'].map((l) => (
                    <div key={l} className="flex items-center gap-2">
                      <RadioGroupItem id={`ds-p-${l}`} value={l.toLowerCase()} />
                      <Label htmlFor={`ds-p-${l}`} className="font-normal">
                        {l}
                      </Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>
          </Demo>
          <Demo title="Date and time" description="Weeks start on Saturday.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date of birth" required>
                <DatePicker
                  value={date}
                  onChange={setDate}
                  withYearSelect
                  placeholder="Pick a date"
                />
              </Field>
              <Field label="Start time">
                <TimePicker value={time} onChange={setTime} min="09:00" max="19:00" />
              </Field>
              <Field label="Report period" className="sm:col-span-2">
                <DateRangePicker
                  value={range}
                  onChange={setRange}
                  className="w-full justify-start"
                />
              </Field>
            </div>
          </Demo>
          <Demo title="Card choice" description="For options that need a short explanation.">
            <RadioGroup
              defaultValue="monthly"
              className="grid gap-2 sm:grid-cols-2"
              aria-label="Billing"
            >
              <RadioCard value="single" title="Single session" description="Pay per visit" />
              <RadioCard value="weekly" title="Weekly" description="Billed every week" />
              <RadioCard value="monthly" title="Monthly" description="12 sessions, 35 days" />
              <RadioCard value="custom" title="Custom" description="Not available" disabled />
            </RadioGroup>
          </Demo>
        </div>
      </section>

      <section>
        <SectionHeader
          title="Status"
          description="Every status has a label and an icon or dot; colour is never the only signal."
        />
        <Card>
          <CardContent className="space-y-3 pt-5">
            <div className="flex flex-wrap gap-2">
              <AppointmentStatusBadge status="scheduled" />
              <AppointmentStatusBadge status="checked_in" />
              <AppointmentStatusBadge status="completed" />
              <AppointmentStatusBadge status="cancelled" />
              <AppointmentStatusBadge status="no_show" />
            </div>
            <div className="flex flex-wrap gap-2">
              <PatientStatusBadge status="active" />
              <PatientStatusBadge status="waitlist" />
              <PatientStatusBadge status="on_hold" />
              <PatientStatusBadge status="discharged" />
              <PaymentStatusBadge status="paid" />
              <PaymentStatusBadge status="partial" />
              <PaymentStatusBadge status="unpaid" />
              <NoteStatusBadge status="draft" />
              <NoteStatusBadge status="submitted" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>Neutral</Badge>
              <Badge tone="primary">Primary</Badge>
              <Badge tone="info">Info</Badge>
              <Badge tone="success">Success</Badge>
              <Badge tone="warning">Warning</Badge>
              <Badge tone="danger">Danger</Badge>
              <Badge tone="outline">Outline</Badge>
            </div>
          </CardContent>
        </Card>
      </section>

      <section>
        <SectionHeader title="Data display" />
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              label="Today’s appointments"
              value={42}
              hint="9 still to come"
              icon={CalendarDays}
              tone="primary"
            />
            <KpiCard label="Active patients" value={186} hint="12 new this month" icon={Users} />
            <KpiCard
              label="Today’s collection"
              value={formatTaka(48500)}
              hint="14 payments"
              icon={CalendarDays}
              tone="success"
            />
            <KpiCard label="Loading" value={0} icon={CalendarDays} loading />
          </div>
          <Card>
            <CardContent className="grid gap-6 pt-5 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">OT monthly (12 sessions)</span>
                  <span className="text-muted-foreground tabular">8 of 12 used</span>
                </div>
                <Progress value={8} max={12} label="Sessions used" />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">SLT weekly (3 sessions)</span>
                  <span className="text-muted-foreground tabular">3 of 3 used</span>
                </div>
                <Progress value={3} max={3} label="Sessions used" tone="warning" />
              </div>
            </CardContent>
          </Card>
          <DataTable
            label="Sample invoices"
            columns={columns}
            data={rows}
            pageSize={4}
            toolbar={
              <FilterBar>
                <SearchInput
                  label="Search invoices"
                  value={search}
                  onChange={setSearch}
                  placeholder="Invoice or patient"
                />
              </FilterBar>
            }
            empty={
              <EmptyState title="No invoices match" description="Try another invoice number." />
            }
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Navigation"
          description="Underline tabs for page sections; segmented controls for view switches."
        />
        <Card>
          <CardContent className="space-y-6 pt-5">
            <Tabs defaultValue="overview">
              <TabsList>
                {[
                  'Overview',
                  'Assessments',
                  'Therapy plan',
                  'Appointments',
                  'Session notes',
                  'Packages',
                  'Billing',
                ].map((t) => (
                  <TabsTrigger key={t} value={t.toLowerCase()}>
                    {t}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="overview" className="text-sm text-muted-foreground">
                Tab content sits directly below, without an extra card.
              </TabsContent>
            </Tabs>
            <Tabs defaultValue="week">
              <SegmentedList aria-label="Calendar view">
                <SegmentedTrigger value="day">Day</SegmentedTrigger>
                <SegmentedTrigger value="week">Week</SegmentedTrigger>
                <SegmentedTrigger value="month">Month</SegmentedTrigger>
              </SegmentedList>
            </Tabs>
          </CardContent>
        </Card>
      </section>

      <section>
        <SectionHeader
          title="Overlays"
          description="Drawers for quick edits, dialogs for short actions, full pages for complex forms."
        />
        <Card>
          <CardContent className="flex flex-wrap gap-2 pt-5">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Record payment</DialogTitle>
                  <DialogDescription>Short, focused tasks belong in a dialog.</DialogDescription>
                </DialogHeader>
                <Field label="Amount" required>
                  <Input inputMode="numeric" placeholder="৳0" />
                </Field>
                <DialogFooter>
                  <Button variant="secondary">Cancel</Button>
                  <Button>Save payment</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">Open drawer</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Edit guardian</SheetTitle>
                  <SheetDescription>Quick edits slide in from the right.</SheetDescription>
                </SheetHeader>
                <SheetBody className="space-y-4">
                  <Field label="Guardian name" required>
                    <Input defaultValue="Sharmin Akter" />
                  </Field>
                  <Field label="Phone" required>
                    <Input defaultValue="01712-345678" />
                  </Field>
                </SheetBody>
                <SheetFooter>
                  <Button variant="secondary">Cancel</Button>
                  <Button>Save changes</Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
            <Button variant="danger-ghost" onClick={() => setConfirmOpen(true)}>
              Confirm dialog
            </Button>
            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              title="Cancel this appointment?"
              description="The session goes back to the patient’s package balance."
              confirmLabel="Cancel appointment"
              cancelLabel="Keep it"
              tone="danger"
              onConfirm={() => {
                setConfirmOpen(false);
                toast.success('Appointment cancelled');
              }}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">Dropdown menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem>Check in</DropdownMenuItem>
                <DropdownMenuItem>Reschedule</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem tone="danger">Cancel appointment</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              onClick={() =>
                toast.success('Patient registered', { description: 'Ayaan Rahman · CZ-1047' })
              }
            >
              Success toast
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                toast.error('Couldn’t save', {
                  description: 'Check your connection and try again.',
                })
              }
            >
              Error toast
            </Button>
          </CardContent>
        </Card>
      </section>

      <section>
        <SectionHeader
          title="Feedback"
          description="Every list has a loading, empty and error state."
        />
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardContent className="space-y-4 pt-5">
              <ListSkeleton rows={3} />
              <InlineLoader label="Checking availability…" />
            </CardContent>
          </Card>
          <Card>
            <EmptyState
              compact
              icon={Users}
              title="No patients yet"
              description="Register your first patient to start booking sessions."
              action={
                <Button size="sm">
                  <Plus /> Register patient
                </Button>
              }
            />
          </Card>
          <Card>
            <ErrorState
              error={new Error('The server didn’t respond.')}
              onRetry={() => toast.info('Retrying…')}
            />
          </Card>
        </div>
      </section>
    </div>
  );
}
