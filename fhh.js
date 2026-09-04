const fs = require("fs");
const fsp = require("fs/promises");
const stream = require("stream");
const streamp = require("stream/promises");
const path = require("path");
const args = process.argv.slice(2);

!async function() {
	const WORKER_URL = "https://app.studiodanv.workers.dev";
	const acc = await login(args[0], args[1]);
	const session = acc.sessionToken;
	if (args[3]) {
		if (session) {
			console.log(`Logged into ${args[0]}!`);
			if (args[2] == "upload") {
				await upload(args[3], session);
			} else if (args[2] == "download") {
				await download(args[3]);
			}
		} else {
			console.error(`Error: ${acc.error}`);
		}
	} else {
		console.log(`Syntax: node "${process.argv[1]}" <username> <password> [upload/download] <file path/project id>`);
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

	async function upload(fileName, session) {
		console.log(`Uploading ${fileName}...`);
		const fileInput = await fs.openAsBlob(fileName);
		const formData = new FormData();
		const CHUNK_SIZE = 18 * 1024 * 1024; // 18MiB
		let offset = 0;
		let chunkIndex = 0;
		const now = new Date();
		while (offset < fileInput.size) {
			const chunk = fileInput.slice(offset, offset + CHUNK_SIZE);
			formData.append("chunks", chunk, `part_${chunkIndex}.sb3`);
			offset += CHUNK_SIZE;
			chunkIndex++;
		}
		formData.append("author", args[0]);
		formData.append("title", `${args[3]}-${Math.random().toString(36).substring(2)}`);
		formData.append("visibility", "private");
		formData.append("description", `${now.toISOString()} or ${now.toTimeString()}`);
		formData.append("credits", path.basename(args[3]));
		formData.append("username", args[0]);
		formData.append("sessionToken", session);
		const hmm = await fetch(`${WORKER_URL}/api/upload`, {
			method: 'POST',
			body: formData,
			headers: {
				"X-Client-Type": "StudioDANV-Web"
			}
		}).then(x => x.json());
		await sleep(200);
		if (hmm.error) {
			console.error(`Error: ${hmm.error}`);
			return;
		}
		const prjs = await fetch(`${WORKER_URL}/api/projects?username=${args[0]}`).then(x => x.json());
		const prj = prjs.find(x => x.projectId === hmm.file_id);
		if (prj) {
			console.log(`The file: ${fileName} is now available on ${prj.webLink}`);
		} else {
			console.error("File uploading failed!");
			return;
		}
	}
	async function download(id) {
		const prjs = await fetch(`${WORKER_URL}/api/projects?username=${args[0]}`).then(x => x.json());
		const prj = prjs.find(x => x.projectId === id);
		if (!prj) {
			console.error("File not found!");
			return;
		}
		console.log(`Downloading ${prj.title} (id ${id}) as ${prj.credits}...`);
		try {
			const res = await fetch(prj.webLink);
			if (!res.ok) {
				console.error("File not available!");
				return;
			}
			const out = fs.createWriteStream(prj.credits);
			const body = stream.Readable.fromWeb(res.body);
			await streamp.finished(body.pipe(out));
			console.log("Download completed successfully!");
		} catch (e) {
			console.error(`Error: ${e}`);
		}
	}
}();