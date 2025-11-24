'use client';

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import QuickAddressEntry from "@/components/QuickAddressEntry";

type HouseSummary = {
  id: string;
  label?: string | null;
  formattedAddress: string;
  hasSmt: boolean;
  entries: number;
};

type ActiveHouse = {
  id: string;
  formattedAddress: string;
  esiid?: string | null;
  utilityName?: string | null;
};

type Props = {
  activeHouse?: ActiveHouse | null;
  houses: HouseSummary[];
  allowAdd: boolean;
  cumulativeEntries: number;
};

export function ProfileAddressSection({
  activeHouse = null,
  houses,
  allowAdd,
  cumulativeEntries,
}: Props) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [editorMode, setEditorMode] = useState<"update" | "add">("update");
  const [showModal, setShowModal] = useState(false);
  const [addressDisplay, setAddressDisplay] = useState(activeHouse?.formattedAddress ?? "");
  const [metaWarning, setMetaWarning] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setAddressDisplay(activeHouse?.formattedAddress ?? "");
  }, [activeHouse?.formattedAddress]);

  const houseCount = houses.length;
  const activeHouseId = activeHouse?.id ?? null;

  const handleAddressSaved = (data: any) => {
    const warningText =
      data?.meta?.previousAuthorizationArchived === true
        ? "Your previous Smart Meter Texas authorization has been archived. Connect this address to continue syncing usage."
        : null;

    if (editorMode === "add") {
      setStatusMessage("New home added. Connect SMT to activate entries.");
    } else {
      setStatusMessage("Address updated. Reconnect SMT if required.");
    }

    setMetaWarning(warningText);
    router.refresh();
    setIsEditing(false);
    setShowModal(true);
  };

  const startUpdate = () => {
    setEditorMode("update");
    setMetaWarning(null);
    setStatusMessage(null);
    setIsEditing((prev) => !prev);
    setShowModal(false);
  };

  const startAdd = () => {
    if (!allowAdd) {
      return;
    }
    setEditorMode("add");
    setMetaWarning(null);
    setStatusMessage(null);
    setIsEditing(true);
    setShowModal(false);
  };

  const handleHouseSwitch = async (houseId: string) => {
    if (houseId === activeHouseId) return;
    try {
      const response = await fetch("/api/user/house/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ houseId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        console.error("Failed to switch house", payload);
        setStatusMessage(payload?.error ?? "Could not select that home.");
        return;
      }
      setStatusMessage(null);
      router.refresh();
    } catch (error) {
      console.error("Error switching house", error);
      setStatusMessage("Something went wrong selecting that home.");
    }
  };

  const editingHouseId = editorMode === "update" ? activeHouseId : null;
  const quickEntryKey = `${editorMode}-${editingHouseId ?? "new"}`;

  const sortedHouses = useMemo(() => {
    return houses.slice().sort((a, b) => {
      if (a.id === activeHouseId) return -1;
      if (b.id === activeHouseId) return 1;
      return a.formattedAddress.localeCompare(b.formattedAddress);
    });
  }, [houses, activeHouseId]);

  return (
    <section className="rounded-3xl border border-brand-cyan/30 bg-brand-navy p-6 text-brand-cyan shadow-[0_0_35px_rgba(56,189,248,0.28)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold uppercase tracking-wide text-brand-cyan">
            Homes & service addresses
          </h2>
          <p className="mt-1 text-xs text-brand-cyan/70">
            Each home earns its own SMT entries. Update or add addresses here—new homes stay inactive
            until you connect Smart Meter Texas.
          </p>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-brand-cyan/60">
            To add another property, go to the Profile page once your current home is connected to SMT.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <button
            onClick={startUpdate}
            className="inline-flex items-center rounded-full border border-brand-cyan/60 bg-brand-cyan/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-cyan transition hover:border-brand-blue hover:text-brand-blue disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!activeHouse}
          >
            {isEditing && editorMode === "update" ? "Cancel" : "Update address"}
          </button>
          <button
            onClick={startAdd}
            className="inline-flex items-center rounded-full border border-brand-blue bg-brand-blue/20 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-blue transition hover:bg-brand-blue/30 disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={!allowAdd}
          >
            Add another home
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-brand-cyan/40 bg-brand-navy/80 p-4 text-sm text-brand-cyan">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-cyan/70">
            Active home
          </p>
          <pre className="mt-2 whitespace-pre-line text-sm text-brand-cyan/90">
            {addressDisplay || "No address on file"}
          </pre>
        </div>
        <div className="rounded-2xl border border-brand-cyan/40 bg-brand-navy/80 p-4 text-sm text-brand-cyan">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-cyan/70">
            Utility details
          </p>
          <div className="mt-2 space-y-1 text-sm text-brand-cyan/90">
            <div>
              <span className="font-semibold">Utility · </span>
              {activeHouse?.utilityName ?? "Unknown"}
            </div>
            <div>
              <span className="font-semibold">ESIID · </span>
              {activeHouse?.esiid ?? "Not available"}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-brand-cyan/40 bg-brand-navy/80 p-4 text-sm text-brand-cyan">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-cyan/70">
            Home summary
          </p>
          <span className="inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-cyan">
            Total entries · {cumulativeEntries}
          </span>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {sortedHouses.length === 0 ? (
            <p className="text-sm text-brand-cyan/70">
              Add your first home address to begin earning SMT entries.
            </p>
          ) : (
            sortedHouses.map((house) => {
              const isActive = house.id === activeHouseId;
              return (
                <button
                  key={house.id}
                  onClick={() => handleHouseSwitch(house.id)}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    isActive
                      ? "border-brand-blue bg-brand-blue/20 text-brand-blue"
                      : "border-brand-cyan/30 bg-brand-navy/70 text-brand-cyan hover:border-brand-blue/60 hover:text-brand-blue"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">
                      {house.label?.trim() || (isActive ? 'Primary home' : 'Additional home')}
                    </div>
                    <span className="rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide">
                      {house.entries} entries
                    </span>
                  </div>
                  <div className="mt-2 whitespace-pre-line text-xs text-brand-cyan/70">
                    {house.formattedAddress}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[11px] uppercase tracking-wide">
                    <span>{house.hasSmt ? "SMT connected" : "SMT pending"}</span>
                    {isActive ? (
                      <span className="font-semibold text-brand-blue">Active</span>
                    ) : (
                      <span className="text-brand-cyan/70">Tap to activate</span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
        {!allowAdd && houseCount > 0 ? (
          <p className="mt-3 text-[11px] uppercase tracking-wide text-amber-200/80">
            Connect SMT for your existing homes to unlock additional addresses.
          </p>
        ) : null}
      </div>

      {metaWarning ? (
        <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
          {metaWarning}
        </div>
      ) : null}

      {statusMessage ? (
        <div className="mt-4 rounded-lg border border-brand-cyan/30 bg-brand-cyan/10 px-4 py-3 text-xs text-brand-cyan">
          {statusMessage}
        </div>
      ) : null}

      {isEditing ? (
        <div className="mt-6 space-y-4 rounded-2xl border border-brand-cyan/40 bg-brand-navy/80 p-5">
          <div className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">
            Saving an address here replaces the old home and deactivates its SMT agreement. To manage
            multiple properties, visit your profile after connecting SMT.
          </div>
          <QuickAddressEntry
            key={quickEntryKey}
            onAddressSubmitted={(value) => setAddressDisplay(value)}
            userAddress={editorMode === "update" ? activeHouse?.formattedAddress ?? "" : ""}
            redirectOnSuccess={false}
            onSaveResult={handleAddressSaved}
            houseIdForSave={editingHouseId}
            keepOtherHouses={editorMode === "add"}
          />
        </div>
      ) : null}

      {showModal ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-3xl border border-brand-cyan/40 bg-brand-navy p-6 text-center shadow-[0_24px_60px_rgba(16,46,90,0.5)]">
            <h3 className="text-lg font-semibold text-brand-cyan">
              Connect your new address to Smart Meter Texas
            </h3>
            <p className="mt-3 text-sm text-brand-cyan/80">
              We updated your address bundle. Head to the API connect page to authorize the home and
              keep entries accruing.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-full border border-brand-cyan/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan transition hover:border-brand-blue hover:text-brand-blue"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowModal(false);
                  router.push("/dashboard/api#smt");
                }}
                className="rounded-full border border-brand-blue bg-brand-blue px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-navy transition hover:bg-brand-blue/90"
              >
                Connect to SMT
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

