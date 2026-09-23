import { createEmptyDocument, type ImageStudioDocument } from "../domain/document";
import { draftRecovery, type ProjectDraft } from "../projects/draftStore";

function documentAt(updatedAt: string): ImageStudioDocument {
  const document = createEmptyDocument("2026-01-01T00:00:00.000Z");
  document.metadata.updatedAt = updatedAt;
  return document;
}

describe("Image Studio draft recovery", () => {
  it("restores only a newer draft based on the same server revision", () => {
    const draft: ProjectDraft = { key: "project:p1", projectId: "p1", baseRevision: 4, savedAt: "2026-01-02T00:00:00Z", document: documentAt("2026-01-02T00:00:00Z") };
    expect(draftRecovery(draft, { revision: 4, document: documentAt("2026-01-01T00:00:00Z") })).toBe("restore");
    expect(draftRecovery(draft, { revision: 5, document: documentAt("2026-01-01T00:00:00Z") })).toBe("restore-as-copy");
    expect(draftRecovery(draft, { revision: 4, document: documentAt("2026-01-03T00:00:00Z") })).toBe("none");
  });
});
