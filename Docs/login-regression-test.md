# Login Regression Test

This manual regression test confirms that logins with existing passwords continue to work after the password validation changes.

## Preconditions
- An existing account that previously logged in successfully.
- Access to the deployed GTC Unified Access form.

## Steps
1. Open the GTC Unified Access form in a browser.
2. Ensure the **Select action** dropdown is set to **Login**.
3. Enter the email address for the existing account.
4. Type the known existing password (even if it does not meet the registration strength requirements).
5. Submit the form by selecting **Continue**.

## Expected Result
- The form submits successfully without password strength errors.
- A confirmation message appears that reads: `✅ Login successful. Welcome back!`

If either condition fails, capture the behavior and report it as a regression.
