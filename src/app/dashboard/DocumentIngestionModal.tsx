"use client";

type Organization = { organization_id: string; organization_name: string };
type Department = { id: string; name: string };

export default function DocumentIngestionModal({
  organization,
  uploaderId,
  departments,
}: {
  organization: Organization;
  uploaderId: string;
  departments: Department[];
}) {
  function openIngestion() {
    window.dispatchEvent(new CustomEvent("savira:open-ingestion", {
      detail: { organization, uploaderId, departments },
    }));
  }

  return (
    <button
      type="button"
      onClick={openIngestion}
      className="inline-flex items-center gap-2 rounded-lg border border-white bg-white px-4 py-2.5 text-sm font-semibold text-[#202024] transition hover:-translate-y-0.5 hover:border-[#f0f0f0] hover:bg-[#f0f0f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#777] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
    >
      <span aria-hidden="true" className="text-base">＋</span>
      Ingest documents
    </button>
  );
}
