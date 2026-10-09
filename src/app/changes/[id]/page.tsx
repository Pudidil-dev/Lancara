import { ChangeDetailScreen } from '@/components/changes/ChangeDetailScreen'

export default async function ChangePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ parse_error?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  return <ChangeDetailScreen id={id} initialParseError={query.parse_error ?? null} />
}
