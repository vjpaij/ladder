import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const GITHUB_REPO = 'vjpaij/ladder';

serve(async (req) => {
  try {
    // Only accept POST requests
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    // Parse the request body for the workflow_id (e.g. "daily_nav_sip_sync.yml")
    const { workflow_id } = await req.json()
    if (!workflow_id) {
      return new Response(JSON.stringify({ error: 'workflow_id is required' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // Get the GitHub PAT from Supabase Secrets
    const githubPat = Deno.env.get('GITHUB_PAT')
    if (!githubPat) {
      return new Response(JSON.stringify({ error: 'GITHUB_PAT secret is missing' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    // Fire the workflow dispatch event to GitHub API
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${workflow_id}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `Bearer ${githubPat}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Supabase-Edge-Function-Cron'
        },
        body: JSON.stringify({
          ref: 'main',
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`GitHub API responded with ${response.status}: ${errorText}`)
    }

    return new Response(
      JSON.stringify({ success: true, message: `Successfully triggered ${workflow_id}` }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})
