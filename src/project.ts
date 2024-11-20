/*******************************************************************************
 * (c) Copyright, Real-Time Innovations, 2024.
 * All rights reserved.
 * No duplications, whole or partial, manual or electronic, may be made
 * without express written permission.  Any such copies, or
 * revisions thereof, must display this notice unaltered.
 * This code contains trade secrets of Real-Time Innovations, Inc.
 */

import * as vscode from "vscode";
import * as os from "os";
import {
    Installation,
    Architecture,
    getDefaultInstallation,
} from "./installation";

import { askQuestion, askQuestionWithJsonResponse, showErrorMessage, showInformationMessage } from "./utils";

export async function createExample(
    prompt: string,
    installations: Installation[] | undefined,
    stream: vscode.ChatResponseStream,
    cancel_token: vscode.CancellationToken
): Promise<void> {
    const tempDir = undefined;

    try {
        // First check if there is a default connext installation and architecture
        if (installations == undefined) {
            stream.markdown(
                "I couldn't find any default Connext DDS installation and architecture. Use the command /connextInfo to set them up."
            );
            return;
        }

        let defaultInstallation = getDefaultInstallation(installations);

        if (defaultInstallation == undefined) {
            stream.markdown(
                "I couldn't find any default Connext DDS installation and architecture. Use the command /connextInfo to set them up."
            );
            return;
        }

        // Generate the project information
        const jsonProject = await askQuestionWithJsonResponse(
            `Analyze the following prompt and provide the information needed to 
            create a Connext DDS workspace in JSON format:
            Prompt: ${prompt}
            Response:
            {
                "workspace_name": "my_project",
                "language": "C++",
                "idl_file_name": "my_project.idl"
                "connext_path": "${defaultInstallation[0].directory}",
                "architecture": "${defaultInstallation[1].name}"
            }
            Instructions:
            * "idl_file_name" refers to the name of the OMG IDL file that will be 
            created
            * "language" can have the following values: "C", "C++98", "Java", "C++11", "C#", "Python" or "unknown"
            * If the "language" is not specified, set it to "unknown"`,
            cancel_token
        );

        // Create a temporary directory for the content
        const tempDir = await vscode.workspace.fs.createDirectory(
            vscode.Uri.file(os.tmpdir())
        );

        // Generate IDL file
        


        // Generate proposed directory structure and content
        let tree: vscode.ChatResponseFileTree[] = [
            {
                name: jsonProject.workspace_name,
                children: [{ name: "README.md" }],
            },
        ];

        const baseLocation = vscode.Uri.file(os.homedir());

        stream.markdown(
            `Here's a proposed directory structure for the ${jsonProject.workspace_name} workspace:\n`
        );
        stream.filetree(tree, baseLocation);
    } catch (error) {
        stream.markdown("An error occurred while creating the example.");
    } finally {
        if (tempDir != undefined) {
            await vscode.workspace.fs.delete(tempDir);
        }
    }
}
