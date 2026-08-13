/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Decks Folder - The folder containing your re Markdown decks */
  "workspacePath": string,
  /** Close Raycast After Creating a Card - Close Raycast after a card is created successfully */
  "closeAfterSubmit": boolean
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `create-card` command */
  export type CreateCard = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `create-card` command */
  export type CreateCard = {}
}
