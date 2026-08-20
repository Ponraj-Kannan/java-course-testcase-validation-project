/**
 * api/_lib/supabase.js
 *
 * Server-side Supabase client and user store operations.
 * Uses SUPABASE_SERVICE_ROLE_KEY for privileged operations (never exposed to client).
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

let supabaseInstance = null

export function getSupabaseClient() {
  if (!supabaseUrl || !supabaseServiceKey) {
    return null
  }
  if (!supabaseInstance) {
    supabaseInstance = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  }
  return supabaseInstance
}

// ── Local Fallback for Dev Environment without active Supabase credentials ───
const localFilePath = path.join(process.cwd(), 'allowed-emails.json')

function loadLocalUsers() {
  try {
    if (fs.existsSync(localFilePath)) {
      const data = JSON.parse(fs.readFileSync(localFilePath, 'utf8'))
      if (Array.isArray(data)) {
        return data.map((item, idx) => {
          if (typeof item === 'string') {
            return {
              id: `local-${idx}`,
              email: item.toLowerCase(),
              role: idx === 0 ? 'admin' : 'student',
              created_at: new Date().toISOString()
            }
          }
          return {
            id: item.id || `local-${idx}`,
            email: (item.email || '').toLowerCase(),
            role: item.role || (idx === 0 ? 'admin' : 'student'),
            created_at: item.created_at || new Date().toISOString()
          }
        })
      }
    }
  } catch (err) {
    console.warn('[Supabase Lib] Failed to read local fallback users:', err.message)
  }
  return []
}

function saveLocalUsers(users) {
  try {
    const formatted = users.map(u => ({
      email: u.email.toLowerCase(),
      role: u.role || 'student'
    }))
    fs.writeFileSync(localFilePath, JSON.stringify(formatted, null, 2), 'utf8')
  } catch (err) {
    console.warn('[Supabase Lib] Failed to write local fallback users:', err.message)
  }
}

// ── Core User Operations ─────────────────────────────────────────────────────

/**
 * Finds a user by email address.
 * Returns user object { id, email, role, created_at } or null.
 */
export async function findUserByEmail(email) {
  if (!email || typeof email !== 'string') return null
  const cleanEmail = email.trim().toLowerCase()

  const client = getSupabaseClient()
  if (client) {
    try {
      const { data, error } = await client
        .from('users')
        .select('id, email, role, created_at, updated_at')
        .ilike('email', cleanEmail)
        .maybeSingle()

      if (error) {
        console.error('[Supabase Lib] findUserByEmail error:', error.message)
      } else if (data) {
        return {
          id: data.id,
          email: data.email.toLowerCase(),
          role: data.role,
          created_at: data.created_at
        }
      }
      return null
    } catch (err) {
      console.error('[Supabase Lib] Supabase query failed:', err.message)
    }
  }

  // Fallback to local user store
  const localUsers = loadLocalUsers()
  return localUsers.find(u => u.email.toLowerCase() === cleanEmail) || null
}

/**
 * Retrieves all registered users.
 * Returns array of user objects.
 */
export async function getAllUsers() {
  const client = getSupabaseClient()
  if (client) {
    try {
      const { data, error } = await client
        .from('users')
        .select('id, email, role, created_at, updated_at')
        .order('created_at', { ascending: true })

      if (error) {
        console.error('[Supabase Lib] getAllUsers error:', error.message)
      } else if (Array.isArray(data)) {
        return data.map(u => ({
          id: u.id,
          email: u.email.toLowerCase(),
          role: u.role,
          created_at: u.created_at
        }))
      }
    } catch (err) {
      console.error('[Supabase Lib] Supabase getAllUsers query failed:', err.message)
    }
  }

  return loadLocalUsers()
}

/**
 * Inserts one or more users into the users table.
 * Each item can be a string (email) or an object { email, role }.
 */
export async function addUsers(items) {
  const normalized = []
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  for (const item of items) {
    const rawEmail = typeof item === 'string' ? item : item?.email
    const rawRole = (typeof item === 'object' && item?.role) ? item.role : 'student'
    const role = ['admin', 'trainer', 'student'].includes(rawRole) ? rawRole : 'student'

    if (typeof rawEmail === 'string') {
      const cleanEmail = rawEmail.trim().toLowerCase()
      if (emailRegex.test(cleanEmail)) {
        normalized.push({ email: cleanEmail, role })
      }
    }
  }

  if (normalized.length === 0) {
    return { count: 0, users: await getAllUsers() }
  }

  const client = getSupabaseClient()
  if (client) {
    try {
      const { data, error } = await client
        .from('users')
        .upsert(normalized, { onConflict: 'email', ignoreDuplicates: false })
        .select('id, email, role, created_at')

      if (error) {
        throw error
      }

      const allUsers = await getAllUsers()
      return { count: normalized.length, users: allUsers }
    } catch (err) {
      console.error('[Supabase Lib] addUsers error:', err.message)
      throw err
    }
  }

  // Fallback local update
  const localUsers = loadLocalUsers()
  for (const item of normalized) {
    const existing = localUsers.find(u => u.email === item.email)
    if (existing) {
      existing.role = item.role
    } else {
      localUsers.push({
        id: `local-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        email: item.email,
        role: item.role,
        created_at: new Date().toISOString()
      })
    }
  }
  saveLocalUsers(localUsers)
  return { count: normalized.length, users: localUsers }
}

/**
 * Deletes a user by email.
 */
export async function deleteUser(email) {
  if (!email) return { success: false, error: 'Email required' }
  const cleanEmail = email.trim().toLowerCase()

  const client = getSupabaseClient()
  if (client) {
    try {
      const { error } = await client
        .from('users')
        .delete()
        .ilike('email', cleanEmail)

      if (error) throw error

      const allUsers = await getAllUsers()
      return { success: true, users: allUsers }
    } catch (err) {
      console.error('[Supabase Lib] deleteUser error:', err.message)
      throw err
    }
  }

  // Fallback local delete
  let localUsers = loadLocalUsers()
  localUsers = localUsers.filter(u => u.email !== cleanEmail)
  saveLocalUsers(localUsers)
  return { success: true, users: localUsers }
}

/**
 * Updates a user's role.
 */
export async function updateUserRole(email, role) {
  if (!email || !role) throw new Error('Email and role are required')
  const cleanEmail = email.trim().toLowerCase()
  const validRole = ['admin', 'trainer', 'student'].includes(role) ? role : 'student'

  const client = getSupabaseClient()
  if (client) {
    const { data, error } = await client
      .from('users')
      .update({ role: validRole })
      .ilike('email', cleanEmail)
      .select()

    if (error) throw error
    return data
  }

  const localUsers = loadLocalUsers()
  const target = localUsers.find(u => u.email === cleanEmail)
  if (target) {
    target.role = validRole
    saveLocalUsers(localUsers)
  }
  return target
}

/**
 * Verifies a Google ID Token using Google's tokeninfo API.
 */
export async function verifyGoogleToken(idToken) {
  if (!idToken) return null

  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    )
    if (!response.ok) {
      return null
    }
    const payload = await response.json()
    const expectedClientId = '207254417956-cgi3av80ac090nqrurpjkdhj19nievvp.apps.googleusercontent.com'
    if (payload.aud !== expectedClientId) {
      console.warn('[Supabase Lib] Token aud does not match expected client ID')
      return null
    }
    return payload
  } catch (error) {
    console.error('[Supabase Lib] Error verifying Google token:', error.message)
    return null
  }
}
