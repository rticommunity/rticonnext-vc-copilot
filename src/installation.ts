/*******************************************************************************
 * (c) Copyright, Real-Time Innovations, 2024.
 * All rights reserved.
 * No duplications, whole or partial, manual or electronic, may be made
 * without express written permission.  Any such copies, or
 * revisions thereof, must display this notice unaltered.
 * This code contains trade secrets of Real-Time Innovations, Inc.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";

import { showErrorMessage } from "./utils";

/**
 * Key used to store the default installation directory for Connext.
 */
const CONNEXT_DEFAULT_INSTALLATION_DIR_KEY = "connextDefaultInstallation";

/**
 * The key used to store and retrieve the default architecture setting for RTI Connext.
 */
const CONNEXT_DEFAULT_ARCHITECTURE_KEY = "connextDefaultArchitecture";

/**
 * A global variable to hold the context of the VS Code extension.
 * This context is provided when the extension is activated and can be used
 * throughout the extension's lifecycle to access global state, subscriptions,
 * and other extension-specific resources.
 * 
 * @type {vscode.ExtensionContext | undefined}
 */
let EXTENSION_CONTEXT: vscode.ExtensionContext | undefined = undefined;

/**
 * Represents a system architecture with a name, environment setup command, and a default flag.
 */
export class Architecture {
    /**
     * Indicates whether this architecture is the default.
     */
    default: boolean;

    /**
     * The name of the architecture.
     */
    name: string;

    /**
     * The command to set up the environment for this architecture.
     */
    setEnvCmd: string;

    /**
     * The command to set up the environment for this architecture when
     * running a tool.
     */
    toolEnvCmd: string;

    /**
     * Creates an instance of the Architecture class.
     * @param name - The name of the architecture.
     * @param setEnvCmd - The command to set up the environment for this architecture.
     * @param defaultArch - Indicates whether this architecture is the default.
     */
    constructor(name: string, setEnvCmd: string, defaultArch: boolean = false) {
        this.name = name;
        this.setEnvCmd = setEnvCmd;
        this.default = defaultArch;

        /* Replace extension with bash */
        this.toolEnvCmd = setEnvCmd
            .replace("zsh", "bash")
            .replace("tcsh", "bash");
    }
}

/**
 * Represents an installation with a specified directory and supported architectures.
 */
export class Installation {
    /**
     * Indicates whether this installation is the default one.
     */
    default: boolean;

    /**
     * The directory where the installation is located.
     */
    directory: string;

    /**
     * The architectures supported by this installation.
     */
    architectures: Architecture[];

    /**
     * Creates an instance of Installation.
     * @param directory - The directory where the installation is located.
     * @param architectures - The architectures supported by this installation.
     * @param defaultInstallation - Indicates whether this installation is the default one.
     */
    constructor(
        directory: string,
        architectures: Architecture[],
        defaultInstallation: boolean = false
    ) {
        this.directory = directory;
        this.architectures = architectures;
        this.default = defaultInstallation;
    }

    /**
     * Retrieves the names of the architectures supported by this installation.
     * @returns An array of architecture names.
     */
    architecture_names(): string[] {
        let names: string[] = [];

        for (let arch of this.architectures) {
            names.push(arch.name);
        }

        return names;
    }
}

/**
 * Finds the architecture directories within the given installation path.
 *
 * @param installationPath - The path to the installation directory.
 * @returns An array of directory names that do not start with "java", or `undefined` if an error occurs.
 */
function findArchitecture(installationPath: string): string[] | undefined {
    const libPath = path.join(installationPath, "lib");

    try {
        // Read the contents of the lib directory synchronously
        const files = fs.readdirSync(libPath);

        // Filter the files to find the directories that don't start with "java"
        const matchingDirs = files.filter((file) => {
            const fullPath = path.join(libPath, file);
            try {
                return (
                    fs.statSync(fullPath).isDirectory() &&
                    !file.startsWith("java")
                );
            } catch (e) {
                return false;
            }
        });

        let result: string[] = [];

        for (let dir of matchingDirs) {
            result.push(dir);
        }

        return result;
    } catch (err) {
        return undefined; // Return undefined if there is an error reading the directory
    }
}

/**
 * Finds the RTI Connext DDS installation directories on the system.
 *
 * This function searches for directories that start with "rti_connext_dds-" in the
 * appropriate parent directory based on the operating system:
 * - On Linux, it searches in the user's home directory.
 * - On macOS, it searches in the "/Applications" directory.
 * - On Windows, it searches in the "Program Files" directory.
 *
 * Additionally, if the `NDDSHOME` environment variable is set, its value is included
 * in the result if it is not already present.
 *
 * @returns {string[] | undefined} An array of paths to the RTI Connext DDS directories,
 * or `undefined` if no directories are found or an error occurs.
 */
function findRTIConnextDDSDirectory(): string[] | undefined {
    let parentDir: string | undefined = undefined;

    if (process.platform === "linux") {
        parentDir = process.env.HOME || process.env.USERPROFILE;
    } else if (process.platform === "darwin") {
        parentDir = "/Applications";
    } else if (process.platform === "win32") {
        parentDir = process.env.ProgramFiles;
    }

    if (!parentDir) {
        return undefined;
    }

    let result: string[] = [];

    try {
        // Read the contents of the home directory synchronously
        const files = fs.readdirSync(parentDir);

        // Filter the files to find directories that start with "rti_connext_dds-"
        const matchingDirs = files.filter((file) => {
            const fullPath = path.join(parentDir, file);
            try {
                return (
                    fs.statSync(fullPath).isDirectory() &&
                    file.startsWith("rti_connext_dds-")
                );
            } catch (e) {
                return false;
            }
        });

        for (let dir of matchingDirs) {
            result.push(path.join(parentDir, dir));
        }
    } catch (err) {
        return undefined;
    }

    if (process.env.NDDSHOME) {
        /* Push if not present */
        if (!result.includes(process.env.NDDSHOME)) {
            result.push(process.env.NDDSHOME);
        }
    }

    return result;
}

/**
 * Retrieves a list of RTI Connext DDS installations.
 *
 * This function searches for RTI Connext DDS installation directories and
 * their corresponding architectures. It constructs an array of `Installation`
 * objects, each containing the directory path and an array of `Architecture`
 * objects with the appropriate environment setup commands.
 *
 * @returns {Installation[]} An array of `Installation` objects representing
 * the found RTI Connext DDS installations. If no installations are found,
 * an empty array is returned.
 */
export function getConnextInstallations(): Installation[] {
    let installations: Installation[] = [];
    let installationDirectories = findRTIConnextDDSDirectory();

    if (
        installationDirectories == undefined ||
        installationDirectories.length == 0
    ) {
        return [];
    }

    // Get the default installation directory and architecture from the global state
    let defaultInstallationDir = undefined;

    if (EXTENSION_CONTEXT != undefined) {
        defaultInstallationDir = EXTENSION_CONTEXT.globalState.get(
            CONNEXT_DEFAULT_INSTALLATION_DIR_KEY
        );
    }

    let count = 1;

    for (let dir of installationDirectories) {
        let architecturesNames = findArchitecture(dir);
        let defaultInstallation = false;

        if (defaultInstallationDir == dir) {
            defaultInstallation = true;
        } else if (
            process.env.NDDSHOME == dir ||
            installationDirectories.length == 1
        ) {
            defaultInstallation = true;
        }

        if (architecturesNames == undefined || architecturesNames.length == 0) {
            installations.push(new Installation(dir, [], defaultInstallation));
            continue;
        }

        if (
            process.platform === "linux" ||
            process.platform === "darwin" ||
            process.platform === "win32"
        ) {
            let shellCmd = process.env.SHELL;

            if (shellCmd == undefined) {
                shellCmd = "/bin/bash";
            }

            let shell = "bash";

            if (shellCmd.endsWith("zsh")) {
                shell = "zsh";
            } else if (shellCmd.endsWith("tcsh")) {
                shell = "tcsh";
            } else if (process.platform === "win32") {
                shell = "bat";
            }

            let defaultArchitecture = undefined;

            if (EXTENSION_CONTEXT != undefined) {
                defaultArchitecture = EXTENSION_CONTEXT.globalState.get(
                    CONNEXT_DEFAULT_ARCHITECTURE_KEY
                );
            }

            let architectures: Architecture[] = [];

            for (let arch of architecturesNames) {
                let setEnvCmd = undefined;

                if (process.platform === "win32") {
                    setEnvCmd = `"${dir}/resource/scripts/rtisetenv_${arch}"`;
                } else {
                    setEnvCmd = `source ${dir}/resource/scripts/rtisetenv_${arch}.${shell}`;
                }

                let defaultArch = false;

                if (defaultInstallation) {
                    if (defaultArchitecture == arch) {
                        defaultArch = true;
                    } else if (architecturesNames.length == 1) {
                        defaultArch = true;
                    }
                }

                architectures.push(
                    new Architecture(arch, setEnvCmd, defaultArch)
                );
            }

            installations.push(
                new Installation(dir, architectures, defaultInstallation)
            );
        }

        count++;
    }

    return installations;
}

/**
 * Retrieves the default installation and its default architecture from a list of installations.
 *
 * @param installations - An array of `Installation` objects to search through.
 * @returns A tuple containing the default `Installation` and its default `Architecture`,
 *          or `undefined` if no default installation or architecture is found.
 */
export function getDefaultInstallation(
    installations: Installation[]
): [Installation, Architecture] | undefined {
    for (let installation of installations) {
        if (installation.default) {
            for (let arch of installation.architectures) {
                if (arch.default) {
                    return [installation, arch];
                }
            }
        }
    }

    return undefined;
}

export function runApplication(
    installations: Installation[] | undefined,
    applicationName: string
) {
    let command = applicationName;

    if (installations != undefined) {
        let defaultInstallation = getDefaultInstallation(installations);

        if (defaultInstallation != undefined) {
            command =
                defaultInstallation[1].toolEnvCmd + " && " + applicationName;
        }
    }

    // Use child_process.exec to run the external application
    exec(command, (err, stdout, stderr) => {
        if (err) {
            // Handle the error
            showErrorMessage(
                `Error running command: ${err.message}`
            );
            return;
        }
    });
}

/**
 * Sets the extension context for installation.
 *
 * @param extensionContext - The context of the extension to be set.
 */
export function setExtensionContextForInstallation(
    extensionContext: vscode.ExtensionContext
) {
    EXTENSION_CONTEXT = extensionContext;
}

/**
 * Sets the default installation and architecture from the provided list of installations.
 * 
 * @param installations - An array of `Installation` objects representing the available installations.
 * @param installation - The `Installation` object to be set as the default.
 * @param architecture - The `Architecture` object to be set as the default for the specified installation.
 */
export function setDefaultInstallation(
    installations: Installation[],
    installation: Installation,
    architecture: Architecture
) {
    installations.forEach((installation) => {
        installation.default = false;

        if (installation.directory === installation.directory) {
            installation.architectures.forEach((arch) => {
                arch.default = false;
            });
        }
    });

    installation.default = true;
    architecture.default = true;

    if (EXTENSION_CONTEXT != undefined) {
        EXTENSION_CONTEXT.globalState.update(
            CONNEXT_DEFAULT_INSTALLATION_DIR_KEY,
            installation.directory
        );
        EXTENSION_CONTEXT.globalState.update(
            CONNEXT_DEFAULT_ARCHITECTURE_KEY,
            architecture.name
        );
    }
}