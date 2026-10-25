'use client';

import * as React from 'react';
import { Ellipsis, Pencil, Plus, Power, Tags } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { FilterBar } from '@/components/data-table/filter-bar';
import { EmptyState } from '@/components/feedback/states';
import { ColorDot } from '@/components/forms/color-picker';
import { Field } from '@/components/forms/field';
import { SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import { isApiError } from '@/lib/api/client';
import {
  useCreateCategory,
  useGoalCategories,
  useSetCategoryStatus,
  useUpdateCategory,
} from '@/lib/api/therapy-plans';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { useSession } from '@/lib/session';
import type { GoalCategory } from '@/lib/types';
import { TherapyTypeStatusBadge } from '../therapy-types/therapy-types-screen';

function CategoryDialog({
  category,
  open,
  onClose,
}: {
  /** Null adds a new one */
  category: GoalCategory | null;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [therapyTypeId, setTherapyTypeId] = React.useState('all');
  const [shownFor, setShownFor] = React.useState<string | null>(null);
  const key = open ? (category?.id ?? 'new') : null;
  if (key !== shownFor) {
    setShownFor(key);
    if (open) {
      setName(category?.name ?? '');
      setDescription(category?.description ?? '');
      setTherapyTypeId(category?.therapyType?.id ?? 'all');
    }
  }
  const types = useTherapyTypeList({ status: 'all' });
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const mutation = category ? update : create;
  const errors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};
  const close = () => {
    create.reset();
    update.reset();
    onClose();
  };
  const submit = () => {
    const input = {
      name: name.trim(),
      description,
      therapyTypeId: therapyTypeId === 'all' ? null : therapyTypeId,
    };
    const options = {
      onSuccess: () => {
        toast.success(category ? 'Category updated' : 'Category added');
        close();
      },
      onError: (e: Error) => {
        if (!(isApiError(e) && e.errors)) toast.error(e.message);
      },
    };
    if (category) update.mutate({ id: category.id, input }, options);
    else create.mutate(input, options);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? 'Edit category' : 'Add goal category'}</DialogTitle>
          <DialogDescription>
            Categories group goals, e.g. “Fine Motor” or “Expressive Language”. They’re optional.
          </DialogDescription>
        </DialogHeader>
        <Field label="Name" required error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field
          label="Therapy"
          error={errors.therapyTypeId}
          helper={
            category && category.goalCount > 0
              ? 'Goals already using it keep it; this only affects which plans can choose it.'
              : 'Offer it for one therapy, or for all.'
          }
        >
          <Select value={therapyTypeId} onValueChange={setTherapyTypeId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All therapies</SelectItem>
              {types.data?.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  <span className="flex items-center gap-2">
                    <ColorDot color={t.color} />
                    {t.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Description" optional error={errors.description}>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending} disabled={!name.trim()}>
            {category ? 'Save' : 'Add category'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The center's goal categories: a short, optional list per therapy. Deactivating keeps
 * them on goals that already use them.
 */
function Categories() {
  const { can } = useSession();
  const manage = can('therapy_goal_categories.manage');
  const [status, setStatus] = React.useState<'ACTIVE' | 'INACTIVE' | 'all'>('all');
  const [therapy, setTherapy] = React.useState('all');
  const { data, isFetching, error, refetch } = useGoalCategories({ status });
  const types = useTherapyTypeList({ status: 'all' });
  const setActive = useSetCategoryStatus();
  const [editing, setEditing] = React.useState<GoalCategory | null | undefined>(undefined);
  const rows = (data ?? []).filter((c) =>
    therapy === 'all'
      ? true
      : therapy === 'general'
        ? !c.therapyType
        : c.therapyType?.id === therapy,
  );

  const columns: ColumnDef<GoalCategory, unknown>[] = [
    {
      id: 'name',
      header: 'Category',
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{row.original.name}</span>
          {row.original.description && (
            <span className="truncate text-xs text-muted-foreground">
              {row.original.description}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'therapy',
      header: 'Therapy',
      cell: ({ row }) =>
        row.original.therapyType ? (
          <span className="inline-flex items-center gap-1.5 text-[13px]">
            <ColorDot color={row.original.therapyType.color} />
            {row.original.therapyType.name}
          </span>
        ) : (
          <span className="text-[13px] text-muted-foreground">All therapies</span>
        ),
    },
    {
      id: 'goals',
      header: 'Goals',
      meta: { className: 'hidden sm:table-cell tabular' },
      cell: ({ row }) => row.original.goalCount,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <TherapyTypeStatusBadge active={row.original.isActive} />,
    },
    ...(manage
      ? [
          {
            id: 'actions',
            header: () => <span className="sr-only">Actions</span>,
            meta: { className: 'w-12 text-right' },
            cell: ({ row }) => {
              const c = row.original;
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(c)}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        setActive.mutate(
                          { id: c.id, isActive: !c.isActive },
                          {
                            onSuccess: () =>
                              toast.success(
                                c.isActive ? 'Category deactivated' : 'Category activated',
                              ),
                            onError: (e) => toast.error(e.message),
                          },
                        )
                      }
                    >
                      <Power /> {c.isActive ? 'Deactivate' : 'Activate'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            },
          } satisfies ColumnDef<GoalCategory, unknown>,
        ]
      : []),
  ];

  const add = manage && (
    <Button onClick={() => setEditing(null)}>
      <Plus /> Add category
    </Button>
  );

  return (
    <>
      <SectionHeader
        title="Goal categories"
        description="Optional groupings for therapy plan goals, per therapy or for all. Goals work without one."
        actions={add}
      />
      <DataTable
        label="Goal categories"
        columns={columns}
        data={rows}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(c) => c.id}
        toolbar={
          <FilterBar>
            <Select value={therapy} onValueChange={setTherapy}>
              <SelectTrigger size="sm" className="w-full sm:w-48" aria-label="Filter by therapy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every category</SelectItem>
                <SelectItem value="general">For all therapies</SelectItem>
                {types.data?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger size="sm" className="w-full sm:w-36" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </FilterBar>
        }
        empty={
          <EmptyState
            icon={Tags}
            title="No goal categories"
            description="Add a few if they help therapists group goals, e.g. Fine Motor, Self-Care or Social Communication."
            action={add}
          />
        }
      />
      <CategoryDialog
        category={editing ?? null}
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
      />
    </>
  );
}

export function GoalCategoriesScreen() {
  return (
    <RequirePermission permission="therapy_plans.read_own">
      <Categories />
    </RequirePermission>
  );
}
