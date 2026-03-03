import ReaderShell from "@/components/reader/ReaderShell";

interface Props {
  params: Promise<{ bookId: string }>;
}

export default async function ReaderPage({ params }: Props) {
  const { bookId } = await params;
  const id = Number(bookId);

  return <ReaderShell bookId={id} />;
}
