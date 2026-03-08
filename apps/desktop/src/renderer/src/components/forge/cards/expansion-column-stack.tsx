import { useEffect, useRef } from "react";

import type { DerivationParentRef } from "@shared/rpc/schemas/forge";
import type { ExpansionColumnDescriptor } from "../forge-page-store";

import { ExpansionColumn } from "./expansion-column";

type ExpansionColumnStackProps = {
  readonly topicKey: string;
  readonly columns: ReadonlyArray<ExpansionColumnDescriptor>;
  readonly expandedDerivationIds: ReadonlySet<number>;
  readonly onCloseColumn: (columnId: string) => void;
  readonly onRegeneratedColumn: (columnId: string) => void;
  readonly onRequestExpansion: (
    descriptor: ExpansionColumnDescriptor,
    sourceColumnParent: DerivationParentRef,
  ) => void;
};

export function ExpansionColumnStack({
  topicKey,
  columns,
  expandedDerivationIds,
  onCloseColumn,
  onRegeneratedColumn,
  onRequestExpansion,
}: ExpansionColumnStackProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (columns.length === 0) return;
    const container = containerRef.current;
    if (!container) return;
    const lastColumn = container.lastElementChild as HTMLElement | null;
    lastColumn?.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" });
  }, [columns.length]);

  if (columns.length === 0) return null;

  return (
    <div ref={containerRef} className="flex min-h-0 shrink-0">
      {columns.map((column) => (
        <ExpansionColumn
          key={column.id}
          topicKey={topicKey}
          column={column}
          expandedDerivationIds={expandedDerivationIds}
          onClose={() => onCloseColumn(column.id)}
          onRegenerated={() => onRegeneratedColumn(column.id)}
          onRequestExpansion={onRequestExpansion}
        />
      ))}
    </div>
  );
}
