import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  PluginProvider,
  type LoadedPlugin,
} from "@plugins/framework/plugins/web-sdk/core";
import { Fields, FieldsForm } from "@plugins/config_v2/plugins/fields/web";
import {
  fakeFetchEndpoint,
  withTransport,
  type FakeFetchEndpoint,
} from "@plugins/infra/plugins/endpoints/web/testing";
import { mediaField, type MediaRef } from "@plugins/fields/plugins/media/core";
import mediaConfigPlugin from "../index";

/**
 * The media renderer inside `FieldsForm` — the generic form a consumer (a
 * site feed's item editor) gets for free: its refs as thumbnails, remove, the
 * dropzone while there is room, and an upload appended and held.
 */

const plugins = [
  {
    id: "config-v2-fields-test",
    description: "slot owner",
    contributions: [],
    slots: Fields,
  },
  { id: "fields/media/config", ...mediaConfigPlugin },
] as unknown as LoadedPlugin[];

const ref = (id: string): MediaRef => ({
  attachmentId: id,
  mime: "image/png",
  filename: `${id}.png`,
  size: 3,
});

const fields = {
  shots: mediaField({ label: "Screenshots", accept: "image/*", max: 2 }),
};

let fake: FakeFetchEndpoint;

function mount(values: { shots: MediaRef[] }, onChange = vi.fn()) {
  const Wrapper = withTransport(fake);
  const ui = (v: { shots: MediaRef[] }): ReactElement => (
    <Wrapper>
      <PluginProvider plugins={plugins}>
        <FieldsForm fields={fields} values={v} onChange={onChange} />
      </PluginProvider>
    </Wrapper>
  );
  return { ...render(ui(values)), onChange };
}

afterEach(cleanup);

describe("media field in FieldsForm", () => {
  it("draws each ref as a thumbnail of its attachment", () => {
    fake = fakeFetchEndpoint();
    const { container, getByText } = mount({ shots: [ref("a1")] });
    expect(getByText("Screenshots")).toBeTruthy();
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/api/attachments/a1");
    // One file of two: the dropzone still takes one more.
    expect(getByText("Add a file")).toBeTruthy();
  });

  it("removes a ref", () => {
    fake = fakeFetchEndpoint();
    const { getByLabelText, onChange } = mount({
      shots: [ref("a1"), ref("a2")],
    });
    fireEvent.click(getByLabelText("Remove a1.png"));
    expect(onChange).toHaveBeenCalledWith("shots", [ref("a2")]);
  });

  it("hides the dropzone once max is reached", () => {
    fake = fakeFetchEndpoint();
    const { queryByText, container } = mount({
      shots: [ref("a1"), ref("a2")],
    });
    expect(queryByText(/Add a file|Add files/)).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it("appends an upload and holds it until its owner links it", async () => {
    fake = fakeFetchEndpoint((call) =>
      call.route === "POST /api/attachments"
        ? { id: "up1", filename: "new.png", mime: "image/png", size: 4 }
        : undefined,
    );
    const { container, onChange } = mount({ shots: [] });
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
    const file = new File(["abcd"], "new.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("shots", [
        {
          attachmentId: "up1",
          mime: "image/png",
          filename: "new.png",
          size: 4,
        },
      ]),
    );
    await waitFor(() =>
      expect(fake.calls.map((c) => c.route)).toContain(
        "PUT /api/attachments/holds",
      ),
    );
    const hold = fake.calls.find(
      (c) => c.route === "PUT /api/attachments/holds",
    );
    const body = hold?.body as { holder: string; ids: string[]; ttlMs: number };
    expect(body.holder).toMatch(/^fields\.media:/);
    expect(body.ids).toEqual(["up1"]);
    expect(body.ttlMs).toBe(24 * 60 * 60 * 1000);
  });

  it("refuses more files than the room left", async () => {
    fake = fakeFetchEndpoint();
    const { container, findByText } = mount({ shots: [] });
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
    const files = ["a", "b", "c"].map(
      (n) => new File(["x"], `${n}.png`, { type: "image/png" }),
    );
    fireEvent.change(input, { target: { files } });
    expect(await findByText("3 files given, room for 2 more.")).toBeTruthy();
    expect(fake.calls).toEqual([]);
  });
});
