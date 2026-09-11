console.log("Initializing...");
const fs = require("fs");
const fsp = require("fs/promises");
const stream = require("stream");
const streamp = require("stream/promises");
const path = require("path");
const rlp = require("readline/promises");
const args = process.argv.slice(2);
const { stdin: input, stdout: output } = require("process");
const rl = rlp.createInterface({ input, output });

!async function() {
	const WORKER_URL = "https://app.studiodanv.workers.dev";
	const destDir = () => dirStack.reduce((obj, key) => obj?.children?.[key], dirs.dirs);
	let first = false;
	let account;
	let saved = {username: args[0], password: args[1]};
	let dirStack = [];
	
	await loginPrompt();
	let dirs = await downloadMeta();
	
	async function loginPrompt() {
		if (saved.password) {
			account = await login(saved.username, saved.password);
			if (account.error) {
				saved = {username: null, password: null};
				console.log(`Login failed: ${account.error}!`);
				await loginPrompt();
			}
			else {
				console.log("Login succeeded!");
				return 1;
			}
		}
		else {
			const username = await input("--- Login ---\nUsername:");
			const pw = await await input("Password:");
			account = await login(username, pw);
			if (account.error) {
				console.log(`Login failed: ${account.error}!`);
				await loginPrompt();
			}
			else {
				console.log("Login succeeded!");
				saved = {username: username, password: pw};
			}
		}
		return 0;
	}
	async function apiFetch(url, options, attempt = 3) {
		try {
			const resp = await fetch(url, options);
			const data = await resp.json();
			if (resp.status == 401 || resp.status == 403) {
				console.log(data.error);
				return {error: data.error, retry: await loginPrompt() + 1};
			}
			return data;
		}
		catch (e) {
			console.log(`${e} ${url}`);
			if (attempt <= 1) return {error: e};
			else return await apiFetch(url, options, attempt - 1);
		}
	}
	async function loadProjects() {
		const data = await apiFetch(`${WORKER_URL}/api/projects?username=${account?.username}&sessionToken=${account?.sessionToken}`);
		if (data?.error) {
			if (data?.retry) {
				console.log("Your session has expired! Relogging in...");
				return await loadProjects();
			}
			else return null;
		}
		else return data?.projects;
	}
	async function input(str = "", df = "") {
		process.stdout.write(`${str}\n> `);
		rl.write(df);
		const answer = await new Promise(resolve => {
			rl.once("line", resolve);
		});
		return answer;
	}
	function sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
	async function login(username, pw) {
		try {
			const res = await fetch(`${WORKER_URL}/api/auth/login`, {
				method: 'POST',
				headers: {
					"Content-Type": "application/json",
					"X-Client-Type": "StudioDANV-Web"
				},
				body: JSON.stringify({
					loginId: username,
					password: pw
				})
			}).then(x => x.json());
			return res;
		} catch (e) {
			return {error: e};
		}
	}
	async function uploadMeta(object) {
		console.log(`Uploading metadata...`);
		const fileInput = new Blob(
			[JSON.stringify(object)],
			{ type: "application/json" }
		);
		const now = new Date();
		try {
			let ids = await uploadParts(fileInput);
			const finalForm = new FormData();
			const allProjects = await loadProjects();
			const update = allProjects?.find(getMeta)?.projectId;
			if (update) finalForm.append("updateProjectId", update);
			finalForm.append("preloadedFileId", ids.join(","));
			finalForm.append("title", ".danv-file-hosting-map"); 
			finalForm.append("visibility", "private"); 
			finalForm.append("author", account?.username); 
			finalForm.append("description", `Last modified: ${now.toISOString()} or ${now.toTimeString()}`); 
			finalForm.append("credits", "Made by heythisismyacc (ezx6t). Do not touch this project, leave it as-is.");
			finalForm.append("username", account?.username); 
			finalForm.append("sessionToken", account?.sessionToken);

			const finalRes = await apiFetch(`${WORKER_URL}/api/upload`, { method: 'POST', body: finalForm, headers:{"X-Client-Type":"StudioDANV-Web"} });
			if (finalRes.success) { 
				console.log("Uploaded successfully!"); 
				console.log(finalRes); 
				await loadProjects();
			} else {
				console.log(finalRes.error || "Lỗi tải lên");
			}
		} catch(err) { 
			console.log("Upload error: " + err.message); 
		}
	}
	async function uploadFile(fileName) {
		console.log(`Uploading ${fileName}...`);
		const fileInput = await fs.openAsBlob(fileName);
		const data = await uploadParts(fileInput);
		if (data?.length) {
			console.log("Uploaded successfully!");
			return data;
		}
		else console.log("Upload failed!");
	}
	async function uploadParts(fileInput) {
		const CHUNK_SIZE = 18 * 1024 * 1024; // 18MiB
		const totalChunks = Math.ceil(fileInput.size / CHUNK_SIZE);
		let offset = 0;
		let chunkIndex = 0;
		let arr = [];
		for (let i = 0; i < totalChunks; i++) {
			const chunk = fileInput.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
			const chunkForm = new FormData();
			chunkForm.append("file", chunk, `part_${i}.sb3`);
			chunkForm.append("username", account?.username);
			chunkForm.append("sessionToken", account?.sessionToken);

			const res = await apiFetch(`${WORKER_URL}/api/upload`, { method: 'POST', body: chunkForm, headers:{"X-Client-Type":"StudioDANV-Web"} });
			if (!res.success) throw new Error(res.error || "Lỗi tải mảnh ghép");
			arr.push(res.file_id);
			return arr;
		}
	}
	async function downloadMeta() {
		console.log(`Downloading metadata...`);
		const allProjects = await loadProjects();
		const url = allProjects?.find(getMeta);
		const res = url?.fileId ? await apiFetch(`${WORKER_URL}/api/project/${url.fileId}`) : null;
		const data = {
			dirs: (res?.dirs) ? res.dirs : ({
				type: "dir",
				children: {}
			})
		};
		if (data) {
			console.log("Downloaded successfully!");
		}
		else {
			console.log("Download failed!");
		}
		return data;
	}
	async function downloadFile(name, id) {
		console.log(`Downloading ${name} (id ${id})...`);
		try {
			const res = await fetch(`${WORKER_URL}/api/project/${id}`);
			if (!res.ok) {
				console.error("File not available!");
				return;
			}
			const out = fs.createWriteStream(name);
			const body = stream.Readable.fromWeb(res.body);
			await streamp.finished(body.pipe(out));
			console.log("Download completed successfully!");
		} catch (e) {
			console.error(`Error: ${e}`);
		}
	}
	function getMeta(prj) {
		return prj.visibility === "private" && prj.author === account?.username && prj.title === ".danv-file-hosting-map" && prj.credits === "Made by heythisismyacc (ezx6t). Do not touch this project, leave it as-is.";
	}
	function addDir(name) {
		if (name === "." || name === ".." || name.includes("/")) return false;
		const dest = destDir();
		if (dest) dest.children[name] = {
			type: "dir",
			children: {}
		};
		else return false;
		return true;
	}
	function addFile(name, content) {
		if (name === "." || name === ".." || name.includes("/")) return false;
		const dest = destDir();
		if (dest) dest.children[name] = {
			type: "file",
			content: content
		};
		else return false;
		return true;
	}
	function rmEntry(name) {
		const dest = destDir();
		if (dest?.children?.[name]) delete dest.children[name];
		else return false;
		return true;
	}
	function cd(name) {
		if (name === ".") return true;
		if (name === "..") {
			dirStack.pop();
			return true;
		}
		if (name === "/") {
			dirStack = [];
			return true;
		}
		const dest = destDir();
		if (dest?.children?.[name]?.type === "dir") {
			dirStack.push(name);
			return true;
		}
		return false;
	}
	function cdc(path) {
		process.chdir(path);
	}
	function ls() {
		return Object.keys(destDir()?.children || []);
	}
	function ls2() {
		return Object.entries(destDir().children).filter(pair => pair[1].type === "file").map(pair => pair[0]);
	}
	async function lsc() {
		const entries = await fsp.readdir(process.cwd(), {
			withFileTypes: true
		});
		return entries.map(entry => `${entry.name}${entry.isDirectory() ? "/" : ""}`);
	}
	async function lsc2() {
		const entries = await fsp.readdir(process.cwd(), {
			withFileTypes: true
		});
		return entries.filter(entry => entry.isFile()).map(entry => entry.name);
	}
	async function mainLoop() {
		console.log(`\nWorking dir: /${dirStack.join("/")}`);
		let cmd = (await input("Enter command:")).toLowerCase();
		switch (cmd) {
			case "cd":
				cd(await input("Enter directory:"));
				break;
			case "ls":
				ls().forEach(item => console.log(item));
				break;
			case "mkdir":
				let res = addDir(await input("Enter directory name:"));
				if (!res) console.log("Invalid directory name!");
				await uploadMeta(dirs)
				break;
			case "rm":
				rmEntry(await input("Enter entry name (do not contain the '/' character):"));
				await uploadMeta(dirs)
				break;
			case "uplfile":
				console.log("Available commands: cd, ls, choose");
				let choose = null;
				while (!choose) {
					console.log(`\nWorking dir: ${process.cwd()}`);
					cmd = (await input("Enter command:")).toLowerCase();
					switch (cmd) {
						case "cd":
							cdc(await input("Enter path:"));
							break;
						case "ls":
							(await lsc()).forEach(item => console.log(item));
							break;
						case "choose":
							let fi = await input("Enter file name:");
							if ((await lsc2()).includes(fi)) choose = fi;
							else console.log("Not a file!");
							break;
						default:
							console.log("Invalid command!");
					}
				}
				const file = await uploadFile(choose);
				if (file) {
					addFile(choose, file.join(","));
					await uploadMeta(dirs);
				}
				break;
			case "dlfile":
				let fil;
				let bc = false;
				while (true) {
					(await ls2()).forEach(item => console.log(item));
					fil = await input("Enter file name (enter '.' to cancel):");
					if (ls2().includes(fil)) break;
					else if (fil === ".") {
						bc = true;
						break;
					}
					else console.log("Not a file!");
				}
				if (bc) break;
				console.log("Available commands: cd, ls, save");
				let loop = !0;
				while (loop) {
					console.log(`\nWorking dir: ${process.cwd()}`);
					cmd = (await input("Enter command:")).toLowerCase();
					switch (cmd) {
						case "cd":
							cdc(await input("Enter path:"));
							break;
						case "ls":
							(await lsc()).forEach(item => console.log(item));
							break;
						case "save":
							loop = !1;
							let dest = destDir();
							await downloadFile(fil, dest.children[fil].content);
							break;
						default:
							console.log("Invalid command!");
					}
				}
				break;
			default:
				console.log("Invalid command!");
		}
	}
	console.log("Available commands: cd, ls, mkdir, rm, uplfile, dlfile");
	while(!0)await mainLoop();
}();
