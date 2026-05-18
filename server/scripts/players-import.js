#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const db = require('../db');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, headers) {
  const { data } = await axios.get(url, { headers, timeout: 25000 });
  return data;
}

function normalizeName(v) {
  return String(v || '').trim().toLowerCase();
}

async function resolveNationalTeamId(nameEn, headers) {
  const url = `https://v3.football.api-sports.io/teams?search=${encodeURIComponent(nameEn)}`;
  const data = await fetchJson(url, headers);
  const response = data?.response || [];
  const target = normalizeName(nameEn);
  const exact = response.find(r => r?.team?.national && normalizeName(r.team.name) === target);
  if (exact) return exact.team.id;
  const contains = response.find(r => r?.team?.national && normalizeName(r.team.name).includes(target));
  return contains?.team?.id || null;
}

async function importPlayers() {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY is missing in server/.env');
  const headers = { 'x-apisports-key': key };

  const teams = await db.query('SELECT code, name_en, name_he FROM teams ORDER BY name_en ASC');
  let totalInsertedOrUpdated = 0;
  let teamsWithSquad = 0;

  for (const t of teams) {
    try {
      const teamId = await resolveNationalTeamId(t.name_en, headers);
      if (!teamId) continue;
      await sleep(120);
      const sqData = await fetchJson(`https://v3.football.api-sports.io/players/squads?team=${teamId}`, headers);
      const squad = sqData?.response?.[0]?.players || [];
      if (!squad.length) continue;
      teamsWithSquad += 1;
      for (const p of squad) {
        const externalId = p.id || null;
        const nameEn = p.name || '';
        if (!nameEn) continue;
        const imageUrl = p.photo || null;
        const countryEn = t.name_en;
        const countryHe = t.name_he;
        const nameHe = nameEn; // fallback: no reliable Hebrew source from API-Football

        await db.run(`
          INSERT INTO players (external_id, name_en, name_he, country_en, country_he, team_code, image_url)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name_en = VALUES(name_en),
            name_he = VALUES(name_he),
            country_en = VALUES(country_en),
            country_he = VALUES(country_he),
            team_code = VALUES(team_code),
            image_url = VALUES(image_url)
        `, [externalId, nameEn, nameHe, countryEn, countryHe, t.code, imageUrl]);
        totalInsertedOrUpdated += 1;
      }
    } catch (e) {
      console.log(`⚠️ skipped ${t.name_en}: ${e.message}`);
    }
  }

  const cnt = await db.one('SELECT COUNT(*) AS n FROM players');
  console.log(`✅ imported/updated rows: ${totalInsertedOrUpdated}`);
  console.log(`✅ teams with squad data: ${teamsWithSquad}`);
  console.log(`✅ total players in DB: ${cnt?.n || 0}`);
}

importPlayers()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('✗ players import failed:', e.message);
    process.exit(1);
  });
