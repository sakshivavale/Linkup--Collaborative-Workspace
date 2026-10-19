# Supabase Auth Email Templates (LinkUp)

This directory contains the verified email templates for LinkUp's Supabase Authentication flows.

---

## 1. Password Reset Email Template

### Location in Supabase Dashboard
1. Go to **Authentication** (sidebar) $\rightarrow$ **Email Templates**.
2. Select **Reset Password** (or **Reset Password Email**).

### Subject
```text
Reset your password - LinkUp
```

### Template Body (HTML)
Copy and paste the contents of [`reset-password.html`](./reset-password.html):

```html
<h2>Reset your password</h2>
<p>Hello,</p>
<p>We received a request to reset your password for your <strong>LinkUp</strong> account. Click the button below to choose a new password:</p>

<p style="margin: 28px 0;">
  <a
    href="{{ .ConfirmationURL }}"
    target="_blank"
    style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);"
  >
    Reset Password
  </a>
</p>

<p style="color: #64748b; font-size: 13px; margin-top: 24px; line-height: 1.5;">
  If the button above does not work, copy and paste this link into your browser:
</p>
<p style="word-break: break-all; font-size: 12px; margin-top: 4px;">
  <a href="{{ .ConfirmationURL }}" target="_blank" style="color: #4f46e5; text-decoration: underline;">
    {{ .ConfirmationURL }}
  </a>
</p>

<p style="color: #94a3b8; font-size: 12px; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
  If you did not request a password reset, you can safely ignore this email. Your account remains secure and your password will not be changed.
</p>
```

---

## 2. Why Did "Follow" Cut Off Without A Clickable Link?

1. **Empty Anchor Tag (`<a></a>`)**: If `<a href="{{ .ConfirmationURL }}"></a>` has no inner text between the tags, the browser/email client renders zero width, rendering only the text "Follow" before it.
2. **Variable Case Sensitivity**: Go templates are case-sensitive. `{{ .ConfirmationURL }}` must have capital `URL`. `{{ .ConfirmationUrl }}` with lowercase `rl` is undefined in Go and renders as empty string.
3. **Missing Tag Closure**: Missing quotes around `href` or an unclosed `<a>` tag causes email parsers to discard the link.

---

## 3. Important Supabase Auth URL Configuration

For the reset link (`{{ .ConfirmationURL }}`) to properly redirect to the Vite frontend on **port 5173**:

In **Authentication** $\rightarrow$ **URL Configuration**:
- **Site URL**: `http://localhost:5173`
- **Redirect URLs**:
  - `http://localhost:5173/**`
  - `http://localhost:5173/reset-password`
  - `http://localhost:5173`
