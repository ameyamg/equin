import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MediaRef } from "@plugins/fields/plugins/media/core";
import {
  fakeFetchEndpoint,
  withTransport,
} from "@plugins/infra/plugins/endpoints/web/testing";
import type {
  FieldDef,
  TableCellProps,
} from "@plugins/primitives/plugins/data-view/web";
import { MediaCell } from "../components/media-cell";

afterEach(cleanup);

// jsdom has no HTMLImageElement.decode(); the viewer decodes neighbours ahead.
Object.defineProperty(HTMLImageElement.prototype, "decode", {
  configurable: true,
  writable: true,
  value: () => new Promise<void>(() => {}),
});

const ref = (id: string, mime = "image/png"): MediaRef => ({
  attachmentId: id,
  mime,
  filename: `${id}.${mime.split("/")[1]}`,
  size: 3,
});

const field = {
  id: "shots",
  label: "Shots",
  type: "media",
} as FieldDef<unknown>;

function mount(refs: MediaRef[]) {
  const onRowClick = vi.fn();
  const Wrapper = withTransport(fakeFetchEndpoint());
  render(
    <Wrapper>
      <div onClick={onRowClick}>
        <MediaCell {...({ field, data: refs } as unknown as TableCellProps)} />
      </div>
    </Wrapper>,
  );
  return { onRowClick };
}

const viewer = () => screen.getByRole("dialog");
const showing = (name: string) =>
  expect(viewer().getAttribute("aria-label")).toBe(`Image viewer: ${name}`);

describe("MediaCell", () => {
  it("opens the viewer over every image and video of the cell, not the row", () => {
    const { onRowClick } = mount([
      ref("a"),
      ref("doc", "application/pdf"),
      ref("b"),
    ]);
    expect(screen.getByText("+2")).toBeTruthy();
    fireEvent.click(screen.getByTitle("a.png"));
    showing("a.png");
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.keyDown(viewer(), { key: "ArrowRight" });
    // The PDF is not viewable: the next is b.
    showing("b.png");
    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    showing("a.png");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("keeps a non-viewable first file a plain thumbnail", () => {
    const { onRowClick } = mount([ref("doc", "application/pdf"), ref("a")]);
    fireEvent.click(screen.getByTitle("doc.pdf"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onRowClick).toHaveBeenCalled();
  });
});
