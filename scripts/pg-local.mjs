// Cluster Postgres portabel untuk dev lokal tanpa Docker/password (trust auth, hanya 127.0.0.1).
// Pemakaian: npm run db:local -- init | start | stop | status
// Butuh binary PostgreSQL (initdb, pg_ctl, createdb). Cari via PG_BIN, PATH, atau instalasi Windows default.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PORT = process.env.PG_LOCAL_PORT || '54329'
const DATA = path.resolve(process.cwd(), '.pgdata')
const USER = 'ripple'
const exe = process.platform === 'win32' ? '.exe' : ''

function findBin() {
  const candidates = [process.env.PG_BIN]
  if (process.platform === 'win32') {
    for (const v of ['18', '17', '16', '15']) candidates.push(`C:\\Program Files\\PostgreSQL\\${v}\\bin`)
  } else {
    candidates.push('/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/opt/homebrew/bin', '/usr/local/bin')
  }
  for (const dir of candidates.filter(Boolean)) {
    if (fs.existsSync(path.join(dir, `initdb${exe}`))) return dir
  }
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['initdb'], { encoding: 'utf8' })
  if (which.status === 0) return path.dirname(which.stdout.split(/\r?\n/)[0])
  throw new Error('Binary PostgreSQL tidak ditemukan. Set PG_BIN ke folder bin PostgreSQL, atau pakai docker compose up -d.')
}

const bin = (name) => path.join(findBin(), `${name}${exe}`)
const run = (name, args) => execFileSync(bin(name), args, { stdio: 'inherit' })

const commands = {
  init() {
    if (fs.existsSync(path.join(DATA, 'PG_VERSION'))) {
      console.log(`cluster sudah ada di ${DATA}`)
    } else {
      run('initdb', ['-D', DATA, '-U', USER, '--auth=trust', '--encoding=UTF8', '--locale=C'])
    }
    commands.start()
    for (const db of ['ripple', 'ripple_test']) {
      const res = spawnSync(bin('createdb'), ['-h', '127.0.0.1', '-p', PORT, '-U', USER, db], { encoding: 'utf8' })
      console.log(res.status === 0 ? `database ${db} dibuat` : `database ${db}: ${res.stderr.trim() || 'sudah ada'}`)
    }
    console.log(`\nDATABASE_URL=postgres://${USER}@localhost:${PORT}/ripple\nDATABASE_URL_TEST=postgres://${USER}@localhost:${PORT}/ripple_test`)
  },
  start() {
    const status = spawnSync(bin('pg_ctl'), ['-D', DATA, 'status'], { encoding: 'utf8' })
    if (status.status === 0) return console.log('postgres lokal sudah berjalan')
    // stdio diabaikan: proses postgres mewarisi handle dan akan menahan pipe terminal bila di-inherit.
    execFileSync(bin('pg_ctl'), ['-D', DATA, '-l', path.join(DATA, 'server.log'), '-o', `-p ${PORT} -c listen_addresses=127.0.0.1`, '-w', 'start'], { stdio: 'ignore' })
    console.log(`postgres lokal berjalan di 127.0.0.1:${PORT} (log: .pgdata/server.log)`)
  },
  stop() {
    run('pg_ctl', ['-D', DATA, '-m', 'fast', 'stop'])
  },
  status() {
    spawnSync(bin('pg_ctl'), ['-D', DATA, 'status'], { stdio: 'inherit' })
  },
}

const cmd = process.argv[2] || 'status'
if (!commands[cmd]) {
  console.error(`perintah tidak dikenal: ${cmd} (init|start|stop|status)`)
  process.exit(1)
}
commands[cmd]()
