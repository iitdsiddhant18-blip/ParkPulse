import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../db';
import { AppError, asyncHandler } from '../errors';
import { requireAuth, signToken } from '../middleware/auth';

export const authRouter = Router();

const registerSchema = z.object({
  full_name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(150),
  phone: z.string().trim().min(7).max(20).optional().nullable(),
  password: z.string().min(8).max(72),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const emailNormalized = body.email.toLowerCase();
    const passwordHash = await bcrypt.hash(body.password, 10);

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (full_name, email, phone, password_hash, role)
       VALUES (?, ?, ?, ?, 'USER')`,
      [body.full_name, emailNormalized, body.phone ?? null, passwordHash]
    );

    const userId = result.insertId;
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT user_id, full_name, email, phone, role, is_active, created_at
         FROM users
        WHERE user_id = ?`,
      [userId]
    );

    const user = rows[0];
    const token = signToken({
      userId: Number(user.user_id),
      email: String(user.email),
      role: user.role as 'USER' | 'ADMIN',
    });

    res.status(201).json({
      token,
      user: {
        user_id: Number(user.user_id),
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        is_active: Boolean(user.is_active),
        created_at: user.created_at,
      },
    });
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const emailNormalized = body.email.toLowerCase();

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT user_id, full_name, email, phone, password_hash, role, is_active, created_at
         FROM users
        WHERE email = ?
        LIMIT 1`,
      [emailNormalized]
    );

    if (rows.length === 0) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const user = rows[0];
    const matches = await bcrypt.compare(body.password, String(user.password_hash));
    if (!matches) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    if (!user.is_active) {
      throw new AppError(403, 'ACCOUNT_DEACTIVATED', 'User account is deactivated');
    }

    const token = signToken({
      userId: Number(user.user_id),
      email: String(user.email),
      role: user.role as 'USER' | 'ADMIN',
    });

    res.status(200).json({
      token,
      user: {
        user_id: Number(user.user_id),
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        is_active: Boolean(user.is_active),
        created_at: user.created_at,
      },
    });
  })
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.status(200).json({ message: 'Logged out successfully' });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT user_id, full_name, email, phone, role, is_active, created_at
         FROM users
        WHERE user_id = ?
        LIMIT 1`,
      [req.user!.userId]
    );

    if (rows.length === 0) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const user = rows[0];
    if (!user.is_active) {
      throw new AppError(403, 'ACCOUNT_DEACTIVATED', 'User account is deactivated');
    }

    res.status(200).json({
      user: {
        user_id: Number(user.user_id),
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        is_active: Boolean(user.is_active),
        created_at: user.created_at,
      },
    });
  })
);

