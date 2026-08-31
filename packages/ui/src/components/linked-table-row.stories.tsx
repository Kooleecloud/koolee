import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "./badge";
import { Button } from "./button";
import { LinkedTableRow } from "./linked-table-row";
import { RawDataDisclosure } from "./raw-data-disclosure";
import { RowLink } from "./row-link";

// Render-only stories: every example builds its own markup (a full table /
// a stateful harness), so args are supplied by `render`, not by Storybook.
const meta: Meta<typeof LinkedTableRow> = {
  title: "Data/LinkedTableRow",
  component: LinkedTableRow,
};

export default meta;
type Story = StoryObj;

const ROWS = [
  {
    id: "3f9a2c41-0000-4000-8000-00000000ab12",
    flight: "DL 402",
    pax: "J. Rivera",
    status: "paid",
  },
  {
    id: "7b1e88d0-0000-4000-8000-0000000044c7",
    flight: "AA 118",
    pax: "M. Osei",
    status: "in_transit",
  },
  {
    id: "c02d5517-0000-4000-8000-000000009f30",
    flight: "UA 77",
    pax: "K. Tanaka",
    status: "exception",
  },
];

/**
 * Click anywhere on a row to follow its link — except on the button, which
 * keeps its own click. Tab through to see that the anchors, not the rows, are
 * what the keyboard reaches.
 */
export const Default: Story = {
  render: () => (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50 text-left">
          <tr>
            <th className="px-4 py-2 font-medium">Ref</th>
            <th className="px-4 py-2 font-medium">Flight</th>
            <th className="px-4 py-2 font-medium">Passenger</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {ROWS.map((row) => (
            <LinkedTableRow key={row.id} className="hover:bg-accent/5">
              <td className="px-4 py-2">
                <RowLink href={`#/bookings/${row.id}`} className="font-mono text-xs">
                  {row.id.slice(-6)}
                </RowLink>
              </td>
              <td className="px-4 py-2">{row.flight}</td>
              <td className="px-4 py-2">{row.pax}</td>
              <td className="px-4 py-2">
                <Badge variant="outline">{row.status}</Badge>
              </td>
              <td className="px-4 py-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => alert("Row click not hijacked")}
                >
                  Ping
                </Button>
              </td>
            </LinkedTableRow>
          ))}
        </tbody>
      </table>
    </div>
  ),
};

export const RawData: StoryObj = {
  render: () => (
    <div className="max-w-md rounded-lg border p-4">
      <p className="mb-1 text-sm">Bag sealed with seal KL-88213 (12.4 kg).</p>
      <RawDataDisclosure data={{ taskId: "0f2b…", sealId: "KL-88213", weightKg: 12.4 }} />
    </div>
  ),
};
