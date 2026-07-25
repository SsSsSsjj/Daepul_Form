const formDocumentIdPattern = /^form-[a-z0-9-]+$/i

type PublicFormLookup<T> = {
  findPublishedBySlug: (slug: string) => Promise<T | null>
  getById: (formId: string) => Promise<T | null>
}

export async function resolvePublicFormReference<T>(
  identifier: string,
  includePrivate: boolean,
  lookup: PublicFormLookup<T>,
) {
  if (includePrivate) return lookup.getById(identifier)

  const slugMatch = await lookup.findPublishedBySlug(identifier)
  if (slugMatch) return slugMatch
  if (!formDocumentIdPattern.test(identifier)) return null

  try {
    return await lookup.getById(identifier)
  } catch {
    // Firestore denies reads for missing or private documents because the
    // public rule depends on resource.data.published. Treat both as not found.
    return null
  }
}
