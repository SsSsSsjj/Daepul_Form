import { describe, expect, it, vi } from 'vitest'
import { resolvePublicFormReference } from './publicFormLookup'

describe('resolvePublicFormReference', () => {
  it('resolves a public slug before attempting a document-id read', async () => {
    const findPublishedBySlug = vi.fn().mockResolvedValue({ id: 'form-a1b2c3d4' })
    const getById = vi.fn()

    await expect(resolvePublicFormReference('summer-camp', false, {
      findPublishedBySlug,
      getById,
    })).resolves.toEqual({ id: 'form-a1b2c3d4' })
    expect(findPublishedBySlug).toHaveBeenCalledWith('summer-camp')
    expect(getById).not.toHaveBeenCalled()
  })

  it('falls back to a real form document id when no slug matches', async () => {
    const findPublishedBySlug = vi.fn().mockResolvedValue(null)
    const getById = vi.fn().mockResolvedValue({ id: 'form-a1b2c3d4' })

    await expect(resolvePublicFormReference('form-a1b2c3d4', false, {
      findPublishedBySlug,
      getById,
    })).resolves.toEqual({ id: 'form-a1b2c3d4' })
    expect(getById).toHaveBeenCalledWith('form-a1b2c3d4')
  })

  it('does not issue a denied document read for an unknown slug', async () => {
    const findPublishedBySlug = vi.fn().mockResolvedValue(null)
    const getById = vi.fn()

    await expect(resolvePublicFormReference('missing-slug', false, {
      findPublishedBySlug,
      getById,
    })).resolves.toBeNull()
    expect(getById).not.toHaveBeenCalled()
  })

  it('loads owner-only form ids directly', async () => {
    const findPublishedBySlug = vi.fn()
    const getById = vi.fn().mockResolvedValue({ id: 'form-private' })

    await expect(resolvePublicFormReference('form-private', true, {
      findPublishedBySlug,
      getById,
    })).resolves.toEqual({ id: 'form-private' })
    expect(findPublishedBySlug).not.toHaveBeenCalled()
  })
})
