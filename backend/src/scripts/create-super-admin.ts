import readline from 'node:readline';
import { generateSecret, generateURI } from 'otplib';
import QRCode from 'qrcode';
import { connectToDatabase, disconnectFromDatabase } from '../config/database.js';
import { getDatabaseEnvironment, getRequiredEnvSecret } from '../config/env.js';
import { PATTERNS } from '../constants/index.js';
import {
  encryptTotpSecret,
  hashAdminPassword,
  validateAdminPasswordStrength,
} from '../lib/crypto.js';
import { AdminUserModel } from '../models/index.js';

async function promptLine(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function promptHiddenPassword(promptText: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return (await promptLine(promptText)).trim();
  }

  return new Promise<string>((resolve) => {
    process.stdout.write(promptText);
    const stdin = process.stdin;
    const prevRawMode = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    let value = '';
    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      for (const ch of text) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(Boolean(prevRawMode));
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(Boolean(prevRawMode));
          process.stdout.write('\n');
          process.exit(1);
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
        } else {
          value += ch;
        }
      }
    };

    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const env = getDatabaseEnvironment();
  const confirmProduction = process.argv.includes('--confirm-production');
  if (
    (env.nodeEnv === 'production' || env.dbName === 'mamladibe') &&
    (!confirmProduction || process.env.ALLOW_PRODUCTION_ADMIN_BOOTSTRAP !== 'true')
  ) {
    throw new Error(
      'Refusing to bootstrap a Super Admin on production database without --confirm-production and ALLOW_PRODUCTION_ADMIN_BOOTSTRAP=true.',
    );
  }

  const totpEncKey = getRequiredEnvSecret('TOTP_ENC_KEY');

  const rawEmail =
    process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase() ||
    (await promptLine('Super Admin email: ')).trim().toLowerCase();

  if (!PATTERNS.EMAIL.test(rawEmail)) {
    throw new Error('A valid Super Admin email address is required.');
  }

  const rawPassword =
    process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim() ||
    (await promptHiddenPassword('Super Admin password (>= 12 chars): '));

  validateAdminPasswordStrength(rawPassword, rawEmail);

  await connectToDatabase(env.dbName);

  try {
    const existing = await AdminUserModel.findOne({ email: rawEmail })
      .select('_id role')
      .lean();
    if (existing) {
      console.log(
        `Admin user "${rawEmail}" already exists (role: ${existing.role}). No changes applied.`,
      );
      return;
    }

    const totpSecret = generateSecret();
    const totpSecretEnc = encryptTotpSecret(totpSecret, totpEncKey);
    const passwordHash = await hashAdminPassword(rawPassword);

    await AdminUserModel.create({
      email: rawEmail,
      passwordHash,
      role: 'super',
      totpSecretEnc,
      totpEnabled: false,
      failedLogins: 0,
      active: true,
      createdAt: new Date(),
    });

    const otpauthUri = generateURI({
      issuer: 'Mamladibe Admin',
      label: rawEmail,
      secret: totpSecret,
    });
    const qrTerminal = await QRCode.toString(otpauthUri, {
      type: 'terminal',
      small: true,
    });

    console.log('\nSuper Admin created successfully.');
    console.log('Scan this QR code in your authenticator app before signing in:');
    console.log(qrTerminal);
    console.log('Note: The QR code is also shown once at first password login.\n');
  } finally {
    await disconnectFromDatabase();
  }
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  process.argv[1].endsWith('create-super-admin.ts');

if (isDirectExecution) {
  main().catch((error: unknown) => {
    console.error(
      'Failed to bootstrap Super Admin:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    process.exitCode = 1;
  });
}

