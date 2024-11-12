/*******************************************************************************
 * (c) Copyright, Real-Time Innovations, 2024.
 * All rights reserved.
 * No duplications, whole or partial, manual or electronic, may be made
 * without express written permission.  Any such copies, or
 * revisions thereof, must display this notice unaltered.
 * This code contains trade secrets of Real-Time Innovations, Inc.
 */

import * as vscode from "vscode";

export const CONNEXT_PRODUCT = "Connext for Github Copilot";

export function showErrorMessage(message: string) {
    vscode.window.showErrorMessage(
        `${CONNEXT_PRODUCT}: ${message}`
    );
}

export function showInformationMessage(message: string) {
    vscode.window.showInformationMessage(
        `${CONNEXT_PRODUCT}: ${message}`
    );
}