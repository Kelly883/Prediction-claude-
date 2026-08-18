# WAF and Bot Protection Guidance

## Overview

This document outlines the recommended edge protection configuration for PredictionPro production deployments.

## Protected Endpoints

The following endpoints should receive the strongest protection:

| Endpoint | Risk | Recommended Protection |
|----------|------|------------------------|
| `/api/auth/login` | Credential stuffing, brute force | Rate limiting + optional CAPTCHA after threshold |
| `/api/auth/register` | Account enumeration, bot signups | Rate limiting + email verification |
| `/api/auth/password-reset/request` | Account enumeration, spam | Rate limiting + CAPTCHA |
| `/api/auth/2fa/*` | 2FA bypass attempts | Strict rate limiting |
| `/api/payments/initialize` | Payment abuse, fraud | Rate limiting + device fingerprinting |
| `/api/admin/*` | Admin compromise | Strict rate limiting + IP allowlisting if possible |
| `/api/media/*/signed-url` | Resource abuse, scraping | Rate limiting + short TTL |

## Recommended Configuration

### Vercel

1. **Enable Vercel Firewall** (or similar edge protection):
   - Rate limiting rules for auth endpoints
   - Geographic blocking if operating in specific regions
   - Bot detection for non-browser user agents

2. **Configure rate limits**:
   - Login: 5 requests per minute per IP
   - Registration: 3 requests per minute per IP
   - Password reset: 3 requests per minute per IP
   - 2FA: 3 attempts per 5 minutes per IP
   - Payment initialization: 10 requests per minute per user

3. **Enable DDoS Protection**:
   - Vercel provides automatic DDoS protection
   - Consider Cloudflare Spectrum for additional protection if needed

### CAPTCHA Strategy

Do NOT enable CAPTCHA everywhere. Use it only where risk justifies it:

- **Login**: Only after 3 failed attempts from same IP
- **Registration**: Always (prevents bot signups)
- **Password reset**: Always (prevents spam)
- **2FA**: Only after 2 failed attempts
- **Payment**: Never (disrupts conversion)

### Bot Detection Signals

Monitor for:
- Missing or generic user-agent strings
- Headless browser detection
- Impossible request patterns (too fast, no mouse movement)
- Known bot IP ranges

### Request Validation

- Validate `Content-Type` headers on all POST requests
- Reject requests with missing `Origin` or `Referer` on state-changing operations
- Block requests with known malicious payloads (SQL injection, XSS patterns)
- Validate request size limits

## Application-Level Protections

The application already implements:
- Dual rate limiting (IP + email) on login
- Account lockout after 5 failed attempts
- CSRF protection on state-changing operations
- Secure cookie attributes (HttpOnly, Secure, SameSite)

## Monitoring

Alert on:
- Rate limit thresholds exceeded
- Unusual spikes in login failures
- Geographic anomalies in auth patterns
- CAPTCHA solve rates (high failure = bot attack)
