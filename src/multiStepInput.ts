/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QuickPickItem, window, Disposable, QuickInputButton, QuickInput, ExtensionContext, QuickInputButtons } from 'vscode';
import { Dotnet } from './dotnet';

const axios = require('axios');
// const { SerialPort } = require('node-usb-native');
import { SerialPortCtrl } from "./serialportctrl";

/**
 * A multi-step input using window.createQuickPick() and window.createInputBox().
 * 
 * This first part uses the helper class `MultiStepInput` that wraps the API for the multi-step case.
 */
export async function multiStepInput(context: ExtensionContext, nanoFrameworkExtensionPath: String) {
	const dfuJtagOptions: QuickPickItem[] = ['DFU mode','JTAG mode']
		.map(label => ({ label }));

    const baudRates: QuickPickItem[] = ['9600','19200','38400','57600','115200','230400','460800','921600','1288000']
		.map(label => ({ label }));

	interface State {
		title: string;
		step: number;
		totalSteps: number;
		targetBoard: string;
		targetBoardType: string;
		imageVersion: QuickPickItem;
		dfuOrJtag: QuickPickItem;
		devicePath: string;
		baudrate: number;
	}

	async function collectInputs() {
		const state = {} as Partial<State>;
		await MultiStepInput.run(input => pickTargetBoard(input, state));
		return state as State;
	}

	const title = 'Flash connected device with nanoFramework';

	async function pickTargetBoard(input: MultiStepInput, state: Partial<State>) {
		const targetImages = await getTargetImages();
		const pick = await input.showQuickPick({
			title,
			step: 1,
			totalSteps: 4,
			placeholder: 'Choose a target board',
			items: targetImages,
			// activeItem: typeof state.resourceGroup !== 'string' ? state.resourceGroup : undefined,
			// buttons: [createResourceGroupButton],
			shouldResume: shouldResume
		});

		state.targetBoard = pick.label || '';

		switch (state.targetBoard?.substring(0,3)) {
			case 'ST_':
				state.targetBoardType = 'STM32';
				state.totalSteps = 3;
				break;
			case 'TI_':
				state.targetBoardType = 'TI';
				state.totalSteps = 2;
				break;
			default:
				state.targetBoardType = 'ESP32';
				state.totalSteps = 4;
				break;
		}

		return (input: MultiStepInput) => imageVersion(input, state);
	}

	async function imageVersion(input: MultiStepInput, state: Partial<State>) {
		const imageVersions = await getImageVersions(state.targetBoard);

		const imageVersion = await input.showQuickPick({
			title,
			step: 2,
			totalSteps: state.totalSteps || 4,
			placeholder: 'Choose the image version for your target board (' + state.targetBoard + ')',
			items: imageVersions,
			shouldResume: shouldResume
		});

		console.log(imageVersion);

		state.imageVersion = imageVersion;

		if(state.targetBoardType !== 'TI') {
			return (input: MultiStepInput) => state.targetBoardType === 'ESP32' ? pickDevicePath(input, state) : pickJTAGOrDFU(input, state);
		}
	}

	// step 3, only for ESP32 devices
	async function pickDevicePath(input: MultiStepInput, state: Partial<State>) {

		const devices = await getDevices();

		const devicePath = await input.showQuickPick({
			title,
			step: 3,
			totalSteps: 4,
			placeholder: 'Choose the device path that you want to flash',
			items: devices,
			shouldResume: shouldResume
		});

		state.devicePath = devicePath.label;

		return (input: MultiStepInput) => pickBaudrate(input, state);
	}


	// step 4, only for ESP32 devices
	async function pickBaudrate(input: MultiStepInput, state: Partial<State>) {
		const baudrate = await input.showQuickPick({
			title,
			step: 4,
			totalSteps: 4,
			placeholder: 'Pick a baud rate',
			items: baudRates,
			shouldResume: shouldResume
		});

		state.baudrate = parseInt(baudrate.label);
	}

	// step 3, only for Texas Instrument devices
	async function pickJTAGOrDFU(input: MultiStepInput, state: Partial<State>) {
		state.dfuOrJtag = await input.showQuickPick({
			title,
			step: 3,
			totalSteps: 3,
			placeholder: 'In what mode would you like to flash the device?',
			items: dfuJtagOptions,
			shouldResume: shouldResume
		});
	}
	

	function shouldResume() {
		// Could show a notification with the option to resume.
		return new Promise<boolean>((resolve, reject) => {
			// noop
		});
	}

	// helper function getting different target images
	async function getTargetImages(): Promise<QuickPickItem[]> {
		const apiUrl = 'https://api.cloudsmith.io/v1/packages/net-nanoframework/';

		const apiRepos = ['nanoframework-images-dev', 'nanoframework-images', 'nanoframework-images-community-targets']
			.map(repo => axios.get(apiUrl + repo));

		let imageArray:string[] = [];
		let targetImages:QuickPickItem[] = [];
	
		await Promise
			.all(apiRepos)
			.then((responses: any)=>{
				responses.forEach((res: { data: { name: string; }[]; }) => {
					res.data.forEach((resData: { name: string; }) => {
						imageArray.push(resData.name);
					});
				});

				targetImages = imageArray
					.filter((value: any, index: any, self: string | any[]) => self.indexOf(value) === index)
					.sort()
					.map((label: any) => ({ label: label }));
			})
			.catch((err: any) => {
				window.showErrorMessage(`Couldn't retrieve live boards from API: ${JSON.stringify(err)}`);

				// return default options if (one) of the HTTP requests fails
				targetImages = ['ESP32_WROOM_32', 'ESP32_PICO']
					.map(label => ({ label }));
			});		

		return targetImages;
	}


	async function getImageVersions(targetBoard: string | undefined): Promise<QuickPickItem[]> {

		console.log('targetboard: ' + targetBoard);
		const apiUrl = 'https://api.cloudsmith.io/v1/packages/net-nanoframework/';

		const apiRepos = ['nanoframework-images-dev', 'nanoframework-images', 'nanoframework-images-community-targets']
			.map(repo => axios.get(apiUrl + repo + '/?query=' + targetBoard));

		let imageVersions:object[] = [];
		let targetImages:QuickPickItem[] = [];
	
		await Promise
			.all(apiRepos)
			.then((responses: any)=>{
				responses.forEach((res: { data: { filename: string; version: string; }[]; }) => {
					res.data.forEach((resData: { filename: string; version: string; }) => {

						console.log(resData);
						imageVersions.push({
							filename: resData.filename,
							version: resData.version
						});
					});
				});

				targetImages = imageVersions
					// .filter((value: any, index: any, self: string | any[]) => self.indexOf(value) === index)
					// .sort((a,b) => (a.version > b.version) ? 1 : ((b.version > a.version) ? -1 : 0))
					.map((label: any) => ({ label: label.filename, description: label.version }));
			})
			.catch((err: any) => {
				window.showErrorMessage(`Couldn't retrieve live boards from API: ${JSON.stringify(err)}`);

				// return default options if (one) of the HTTP requests fails
				targetImages = ['ESP32_WROOM_32', 'ESP32_PICO']
					.map(label => ({ label }));
			});		

		return targetImages;
	}

	async function getDevices() {
		let ports = await SerialPortCtrl.list(nanoFrameworkExtensionPath);

		const devicePaths: QuickPickItem[] = ports
			.map((label) => ({ label: label.port, description: label.desc }));

		return devicePaths;
	}

	const state = await collectInputs();

	window.showInformationMessage(`Flashing '${state.targetBoard}' device on ${state.devicePath}`);

	let cliArguments: string;

	switch (state.targetBoard?.substring(0,3)) {
		case 'ST_': 
			cliArguments = `--target ${state.targetBoard} --fwversion ${state.imageVersion.description} ${state.dfuOrJtag.label === 'DFU mode' ? '--dfu' : '--jtag'}`;
			break;

		case 'TI_':
			cliArguments = `--target ${state.targetBoard} --fwversion ${state.imageVersion.description}`;
			break;

		default:
			cliArguments = `--target ${state.targetBoard} --serialport ${state.devicePath} --fwversion ${state.imageVersion.description} --baud ${state.baudrate}`;
			break;
	}

	if(state.imageVersion.description && state.imageVersion.description.includes("preview")) {
		cliArguments += " --preview";
	}

	Dotnet.flash(nanoFrameworkExtensionPath, cliArguments);
}


// -------------------------------------------------------
// Helper code that wraps the API for the multi-step case.
// -------------------------------------------------------


class InputFlowAction {
	static back = new InputFlowAction();
	static cancel = new InputFlowAction();
	static resume = new InputFlowAction();
}

type InputStep = (input: MultiStepInput) => Thenable<InputStep | void>;

interface QuickPickParameters<T extends QuickPickItem> {
	title: string;
	step: number;
	totalSteps: number;
	items: T[];
	activeItem?: T;
	placeholder: string;
	buttons?: QuickInputButton[];
	shouldResume: () => Thenable<boolean>;
}

interface InputBoxParameters {
	title: string;
	step: number;
	totalSteps: number;
	value: string;
	prompt: string;
	validate: (value: string) => Promise<string | undefined>;
	buttons?: QuickInputButton[];
	shouldResume: () => Thenable<boolean>;
}

class MultiStepInput {

	static async run<T>(start: InputStep) {
		const input = new MultiStepInput();
		return input.stepThrough(start);
	}

	private current?: QuickInput;
	private steps: InputStep[] = [];

	private async stepThrough<T>(start: InputStep) {
		let step: InputStep | void = start;
		while (step) {
			this.steps.push(step);
			if (this.current) {
				this.current.enabled = false;
				this.current.busy = true;
			}
			try {
				step = await step(this);
			} catch (err) {
				if (err === InputFlowAction.back) {
					this.steps.pop();
					step = this.steps.pop();
				} else if (err === InputFlowAction.resume) {
					step = this.steps.pop();
				} else if (err === InputFlowAction.cancel) {
					step = undefined;
				} else {
					throw err;
				}
			}
		}
		if (this.current) {
			this.current.dispose();
		}
	}

	async showQuickPick<T extends QuickPickItem, P extends QuickPickParameters<T>>({ title, step, totalSteps, items, activeItem, placeholder, buttons, shouldResume }: P) {
		const disposables: Disposable[] = [];
		try {
			return await new Promise<T | (P extends { buttons: (infer I)[] } ? I : never)>((resolve, reject) => {
				const input = window.createQuickPick<T>();
				input.title = title;
				input.step = step;
				input.totalSteps = totalSteps;
				input.placeholder = placeholder;
				input.items = items;
				if (activeItem) {
					input.activeItems = [activeItem];
				}
				input.buttons = [
					...(this.steps.length > 1 ? [QuickInputButtons.Back] : []),
					...(buttons || [])
				];
				disposables.push(
					input.onDidTriggerButton(item => {
						if (item === QuickInputButtons.Back) {
							reject(InputFlowAction.back);
						} else {
							resolve(<any>item);
						}
					}),
					input.onDidChangeSelection(items => resolve(items[0])),
					input.onDidHide(() => {
						(async () => {
							reject(shouldResume && await shouldResume() ? InputFlowAction.resume : InputFlowAction.cancel);
						})()
							.catch(reject);
					})
				);
				if (this.current) {
					this.current.dispose();
				}
				this.current = input;
				this.current.show();
			});
		} finally {
			disposables.forEach(d => d.dispose());
		}
	}

	async showInputBox<P extends InputBoxParameters>({ title, step, totalSteps, value, prompt, validate, buttons, shouldResume }: P) {
		const disposables: Disposable[] = [];
		try {
			return await new Promise<string | (P extends { buttons: (infer I)[] } ? I : never)>((resolve, reject) => {
				const input = window.createInputBox();
				input.title = title;
				input.step = step;
				input.totalSteps = totalSteps;
				input.value = value || '';
				input.prompt = prompt;
				input.buttons = [
					...(this.steps.length > 1 ? [QuickInputButtons.Back] : []),
					...(buttons || [])
				];
				let validating = validate('');
				disposables.push(
					input.onDidTriggerButton(item => {
						if (item === QuickInputButtons.Back) {
							reject(InputFlowAction.back);
						} else {
							resolve(<any>item);
						}
					}),
					input.onDidAccept(async () => {
						const value = input.value;
						input.enabled = false;
						input.busy = true;
						if (!(await validate(value))) {
							resolve(value);
						}
						input.enabled = true;
						input.busy = false;
					}),
					input.onDidChangeValue(async text => {
						const current = validate(text);
						validating = current;
						const validationMessage = await current;
						if (current === validating) {
							input.validationMessage = validationMessage;
						}
					}),
					input.onDidHide(() => {
						(async () => {
							reject(shouldResume && await shouldResume() ? InputFlowAction.resume : InputFlowAction.cancel);
						})()
							.catch(reject);
					})
				);
				if (this.current) {
					this.current.dispose();
				}
				this.current = input;
				this.current.show();
			});
		} finally {
			disposables.forEach(d => d.dispose());
		}
	}
}