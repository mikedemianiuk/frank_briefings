#!/bin/bash
# Setup Email Configuration for Briefings
# Run with: bash scripts/setup-email.sh

set -e

echo "📧 Briefings Email Setup"
echo "========================"
echo ""

# Function to read input with default
read_with_default() {
    local prompt="$1"
    local default="$2"
    local value

    if [ -n "$default" ]; then
        read -p "$prompt [$default]: " value
        echo "${value:-$default}"
    else
        read -p "$prompt: " value
        echo "$value"
    fi
}

# Get Resend API Key
echo "Step 1: Resend API Key"
echo "----------------------"
echo "Get your key at: https://resend.com/api-keys"
echo ""
RESEND_API_KEY=$(read_with_default "Enter your Resend API Key (re_...)" "")

if [ -z "$RESEND_API_KEY" ]; then
    echo "❌ API Key is required"
    exit 1
fi

# Get Email From
echo ""
echo "Step 2: From Address"
echo "--------------------"
echo "This must be a verified domain in Resend"
echo "For testing, you can use: onboarding@resend.dev"
echo ""
EMAIL_FROM=$(read_with_default "From address" "onboarding@resend.dev")

# Get Email To
echo ""
echo "Step 3: Recipient Address(es)"
echo "------------------------------"
echo "Enter one or more email addresses (comma-separated)"
echo ""
EMAIL_TO=$(read_with_default "To address(es)" "")

if [ -z "$EMAIL_TO" ]; then
    echo "❌ At least one recipient is required"
    exit 1
fi

# Get Subject Prefix (optional)
echo ""
echo "Step 4: Email Subject Prefix (Optional)"
echo "----------------------------------------"
echo "This will be prepended to your digest titles"
echo "Examples: [Briefings], 🥩 The Beef, or leave empty"
echo ""
EMAIL_SUBJECT_PREFIX=$(read_with_default "Subject prefix" "[Briefings]")

# Confirm
echo ""
echo "📝 Configuration Summary"
echo "========================"
echo "From: $EMAIL_FROM"
echo "To: $EMAIL_TO"
echo "Subject Prefix: $EMAIL_SUBJECT_PREFIX"
echo ""
read -p "Deploy this configuration? (y/n): " confirm

if [ "$confirm" != "y" ]; then
    echo "❌ Cancelled"
    exit 1
fi

# Deploy secrets and vars
echo ""
echo "🚀 Deploying configuration..."
echo ""

# Set the secret (API key)
echo "$RESEND_API_KEY" | npx wrangler secret put RESEND_API_KEY

# Update wrangler.toml with EMAIL_FROM, EMAIL_TO, and EMAIL_SUBJECT_PREFIX
# Note: This is a simple approach - you might want to use a proper TOML editor
echo ""
echo "✏️  Updating wrangler.toml..."

# Backup wrangler.toml
cp wrangler.toml wrangler.toml.backup

# Add email vars to wrangler.toml if not present
if ! grep -q "EMAIL_FROM" wrangler.toml; then
    # Add after [vars] section
    sed -i.bak "/\[vars\]/a\\
EMAIL_FROM = \"$EMAIL_FROM\"\\
EMAIL_TO = \"$EMAIL_TO\"\\
EMAIL_SUBJECT_PREFIX = \"$EMAIL_SUBJECT_PREFIX\"
" wrangler.toml
    echo "✅ Added email configuration to wrangler.toml"
else
    echo "⚠️  Email vars already exist in wrangler.toml - please update manually:"
    echo "   EMAIL_FROM = \"$EMAIL_FROM\""
    echo "   EMAIL_TO = \"$EMAIL_TO\""
    echo "   EMAIL_SUBJECT_PREFIX = \"$EMAIL_SUBJECT_PREFIX\""
fi

echo ""
echo "✅ Configuration complete!"
echo ""
echo "Next steps:"
echo "1. Deploy your worker: pnpm deploy"
echo "2. Test with: pnpm trigger weekly-summary"
echo ""
echo "Note: Backup created at wrangler.toml.backup"
