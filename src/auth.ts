/*******************************************************************************
 * (c) Copyright, Real-Time Innovations, 2024.
 * All rights reserved.
 * No duplications, whole or partial, manual or electronic, may be made
 * without express written permission.  Any such copies, or
 * revisions thereof, must display this notice unaltered.
 * This code contains trade secrets of Real-Time Innovations, Inc.
 */
import axios from "axios";
import * as crypto from "crypto";
import * as http from "http";
import { jwtDecode } from "jwt-decode";
import { URLSearchParams } from "url";
import * as vscode from "vscode";

interface Auth0Config {
    audience: string;
    clientId: string;
    domain: string;
}

export class Auth {

    private static readonly auth0Config: Auth0Config = {
        audience: "https://chatbot.rti.com/api/v1",
        clientId: "deY3Vcmm0MWQBCsJTrCy4fZTTUO7u9gF",
        domain: "dev-6pfajgsd68a3srda.us.auth0.com",
    };
    private static readonly port: number = 3000;
    private static readonly redirectUri: string = `http://localhost:${this.port}/callback`;

    private static codeVerifier: string | undefined;
    private static context: vscode.ExtensionContext | undefined;
    private static state: string | undefined;

    public static async setup(context: vscode.ExtensionContext): Promise<void> {
        this.context = context;
        if (this.context) {
            await this.context.secrets.delete("accessToken");
        } else {
            throw new Error("Error logging out: context is not initialized.");
        }
    }

    public static async login(): Promise<void> {
        if (!this.context) {
            throw new Error(
                "Error logging in: context is not initialized. Have you called setup()?");
        }

        try {
            // Generate PKCE verifier and challenge
            this.codeVerifier = this.generateCodeVerifier();
            const codeChallenge = this.generateCodeChallenge(this.codeVerifier);

            // Generate a random state
            this.state = this.generateState();

            // Build the Auth URL
            const authUrl = `https://${this.auth0Config.domain}/authorize?` + new URLSearchParams({
                client_id: this.auth0Config.clientId,
                code_challenge_method: "S256",
                code_challenge: codeChallenge,
                redirect_uri: this.redirectUri,
                response_type: "code",
                scope: "ask:question session:create session:delete session:update offline_access", // offline_access scope is required for refresh tokens
                audience: this.auth0Config.audience,
                state: this.state,
            }).toString();

            // Open the user's browser for login
            await vscode.env.openExternal(vscode.Uri.parse(authUrl));

            // Wait for the callback to retrieve the authorization code
            const { authCode, receivedState } = await this.waitForAuthCode();
            if (!authCode) {
                throw new Error("Authentication failed. No authorization code received.");
            }

            // Validate the state
            if (receivedState !== this.state) {
                throw new Error("Authentication failed. State mismatch.");
            }

            // Exchange the authorization code for an access token and refresh token
            const { accessToken, refreshToken } = await this.exchangeAuthCodeForTokens(authCode, this.codeVerifier);

            // Store the tokens in secretStorage
            await this.context.secrets.store("accessToken", accessToken);
            await this.context.secrets.store("refreshToken", refreshToken);
        } catch (error) {
            throw new Error("Login failed: " + error);
        }
    }

    public static async logout(): Promise<void> {
        if (this.context) {
            await this.context.secrets.delete("accessToken");
            await this.context.secrets.delete("refreshToken");
        } else {
            throw new Error("Error logging out: context is not initialized.");
        }
    }

    /**
     * Get the access token from secret storage. If the token has expired,
     * refresh it.
     * @returns The access token or undefined if an error occurred.
     * @throws If the context is not initialized.
     */
    public static async getAccessToken(): Promise<string | undefined> {
        if (this.context) {
            let accessToken = await this.context.secrets.get("accessToken");
            if (!accessToken) {
                // If there is no access token, then the user is not logged in
                return undefined;
            }

            const decodedToken: { exp: number } = jwtDecode(accessToken);
            const currentTime = Math.floor(Date.now() / 1000);

            if (decodedToken.exp < currentTime) {
                accessToken = await this.refreshAccessToken();
            }

            return accessToken;
        } else {
            throw new Error(
                "Error getting access token: context is not initialized. Have you called setup()?");
        }
    }

    /**
     * Helper function to base64 URL encode a buffer.
     * @param buffer The buffer to encode.
     * @returns The base64 URL encoded string.
     * @see https://datatracker.ietf.org/doc/html/rfc4648#section-5
     */
    private static base64URLEncode(buffer: Buffer): string {
        return buffer.toString('base64').replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    }

    /**
     * Generate a random code verifier for PKCE.
     * @returns The code verifier as a base64 URL encoded string.
     * @see https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce/add-login-using-the-authorization-code-flow-with-pkce#create-code-verifier
     * @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.1
     */
    private static generateCodeVerifier(): string {
        return this.base64URLEncode(crypto.randomBytes(32));
    }

    /**
     * Generate a code challenge from a code verifier.
     * @param verifier The code verifier to generate the challenge from.
     * @returns The code challenge as a base64 URL encoded string.
     * @see https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce/add-login-using-the-authorization-code-flow-with-pkce#create-code-challenge
     * @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.2
     */
    private static generateCodeChallenge(verifier: string): string {
        return this.base64URLEncode(crypto.createHash("sha256").update(verifier).digest());
    }

    /**
     * Generate a random state (nonce) for the OAuth2 flow.
     * @returns The state as a base64 URL encoded string.
     * @see https://auth0.com/docs/secure/attack-protection/state-parameters
     */
    private static generateState(): string {
        return this.base64URLEncode(crypto.randomBytes(16));
    }

    /**
     * Refresh the access token using the refresh token.
     * @returns The new access token.
     * @throws If the context is not initialized.
     * @throws If the refresh token is not available or the request fails.
     * @see https://auth0.com/docs/secure/tokens/refresh-tokens/use-refresh-tokens
     */
    private static async refreshAccessToken(): Promise<string> {
        if (!this.context) {
            throw new Error("Context is not initialized. Have you called setup()?");
        }

        const tokenUrl = `https://${this.auth0Config.domain}/oauth/token`;
        const refreshToken = await this.context.secrets.get("refreshToken");
        try {
            if (!refreshToken) {
                throw new Error("No refresh token available. Please log in again.");
            }
            const response = await axios.post(tokenUrl, new URLSearchParams({
                grant_type: "refresh_token",
                client_id: this.auth0Config.clientId,
                refresh_token: refreshToken,
            }), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });

            const newAccessToken = response.data.access_token;
            const newRefreshToken = response.data.refresh_token;

            await this.context.secrets.store("accessToken", newAccessToken);
            await this.context.secrets.store("refreshToken", newRefreshToken);

            return newAccessToken;
        } catch (error: any) {
            vscode.window.showErrorMessage(
                "Error refreshing access token: " + error);
            if (error.response && error.response.data) {
                vscode.window.showErrorMessage(
                    `Failed to refresh access token: ${error.response.data.error}`);
            }
            throw error;
        }
    }

    /**
     * Wait for the callback from the OAuth2 flow to retrieve the authorization code.
     * @returns The authorization code and state.
     * @see https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce/add-login-using-the-authorization-code-flow-with-pkce#authorize-user
     */
    private static waitForAuthCode(): Promise<{ authCode: string | null, receivedState: string | null }> {
        return new Promise((resolve) => {
            const server = http.createServer((req, res) => {
                const url = new URL(req.url || "", `http://localhost:${this.port}`);
                if (url.pathname === "/callback" && url.searchParams.has("code")) {
                    const authCode = url.searchParams.get("code");
                    const receivedState = url.searchParams.get("state");
                    res.writeHead(200, { "Content-Type": "text/html" });
                    res.end("Authentication successful! You can close this window.");
                    server.close();
                    resolve({ authCode, receivedState });
                } else {
                    res.writeHead(400, { "Content-Type": "text/html" });
                    res.end("Invalid callback URL.");
                }
            });

            server.listen(this.port, () => {
                console.log(`Waiting for callback on ${this.redirectUri}`);
            });

            server.on("error", (err) => {
                console.error("Server error:", err);
                resolve({ authCode: null, receivedState: null });
            });
        });
    }

    /**
     * Exchange the authorization code for an access token and refresh token.
     * @param authCode The authorization code received from the OAuth2 flow.
     * @param codeVerifier The code verifier used in the OAuth2 flow.
     * @returns The access token and refresh token.
     * @throws If the request fails.
     * @see https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce/add-login-using-the-authorization-code-flow-with-pkce#request-tokens
     */
    private static async exchangeAuthCodeForTokens(authCode: string, codeVerifier: string): Promise<{ accessToken: string, refreshToken: string }> {
        const tokenUrl = `https://${this.auth0Config.domain}/oauth/token`;
        try {
            const response = await axios.post(tokenUrl, new URLSearchParams({
                grant_type: "authorization_code",
                client_id: this.auth0Config.clientId,
                code: authCode,
                code_verifier: codeVerifier,
                redirect_uri: this.redirectUri,
            }), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });

            const accessToken = response.data.access_token;
            const refreshToken = response.data.refresh_token;

            return { accessToken, refreshToken };
        } catch (error: any) {
            vscode.window.showErrorMessage(
                "Error exchanging code for tokens: " + error);
            if (error.response && error.response.data) {
                vscode.window.showErrorMessage(
                    `Failed to exchange code for tokens: ${error.response.data.error}`);
            }
            throw error;
        }
    }

}
