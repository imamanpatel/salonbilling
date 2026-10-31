import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { fromIsoDate, toIsoDate } from '../lib/dates.js';
import { badRequest, notFound } from '../lib/errors.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to avoid misreading

/** 8-character invite code (32^8 combinations); the database enforces uniqueness. */
export function randomReferralCode() {
  return Array.from(crypto.randomBytes(8), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

export const clientInclude = {
  assignedTo: { select: { id: true, name: true } },
  homeBranch: { select: { id: true, name: true } },
};

export const toClientData = (body) => ({ ...body, dob: fromIsoDate(body.dob), anniversary: fromIsoDate(body.anniversary) });
export const toClientDto = (client) => ({ ...client, dob: toIsoDate(client.dob), anniversary: toIsoDate(client.anniversary) });

export async function findOrgClient(id, organizationId) {
  const client = await prisma.client.findFirst({ where: { id, organizationId }, include: clientInclude });
  if (!client) throw notFound('Client');
  return client;
}

/** A client or enquiry can only be assigned to an active user of the same organisation. */
export async function assertAssignee(assignedToId, organizationId) {
  if (!assignedToId) return;
  const exists = await prisma.user.count({ where: { id: assignedToId, organizationId, isActive: true } });
  if (!exists) throw badRequest('Pick a valid team member', { assignedToId: 'Pick a valid team member' });
}
