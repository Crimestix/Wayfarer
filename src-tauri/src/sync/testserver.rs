//! Nur für Tests: ein Gegenpart für GitHubs Schnittstelle auf diesem Rechner – dieselbe Ablage
//! im Speicher wie die Attrappe der Oberfläche. Beantwortet alle Anfragen aus Abschnitt 3.2
//! (samt Archiv mit Umleitung, `compare` und `truncated`), mit Stellschrauben für Störungen.
//! Nie eine echte Anfrage nach draußen.

use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

use reqwest::Url;
use serde_json::{json, Value};

use super::archive;
use super::local::blob_sha;

#[derive(Clone)]
pub struct Commit {
    pub tree: String,
    pub parent: Option<String>,
    pub message: String,
}

/// Eine vorgegebene Antwort für die nächste Anfrage, deren „METHODE pfad“ `contains` enthält.
pub struct Forced {
    pub contains: String,
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

#[derive(Default)]
pub struct Repo {
    pub blobs: BTreeMap<String, Vec<u8>>,
    /// Baum → (Pfad → Kennung)
    pub trees: BTreeMap<String, BTreeMap<String, String>>,
    pub commits: BTreeMap<String, Commit>,
    pub head: Option<String>,
    pub private: bool,
    /// Ein rekursiver Baum kommt als `truncated`.
    pub truncate: bool,
    /// Protokoll: „METHODE pfad“ und die Kopfzeilen jeder Anfrage.
    pub log: Vec<(String, Vec<String>)>,
    pub forced: VecDeque<Forced>,
    /// Vor dem nächsten PATCH schiebt ein anderer einen Commit ein.
    pub push_in_before_patch: Option<BTreeMap<String, String>>,
    /// Nach so vielen Anfragen wird die Verbindung abgebrochen (einmal).
    pub drop_after: Option<usize>,
    /// Läuft bei jeder Anfrage mit „METHODE pfad“ – so schreibt „gleichzeitig“ etwas anderes.
    #[allow(clippy::type_complexity)]
    pub on_request: Option<Box<dyn FnMut(&str) + Send>>,
    counter: u64,
}

impl Repo {
    fn put_blob(&mut self, bytes: &[u8]) -> String {
        let sha = blob_sha(bytes);
        self.blobs.insert(sha.clone(), bytes.to_vec());
        sha
    }
    fn put_tree(&mut self, files: BTreeMap<String, String>) -> String {
        let listing: String = files.iter().map(|(p, s)| format!("{p}:{s}\n")).collect();
        let sha = blob_sha(format!("tree\n{listing}").as_bytes());
        self.trees.insert(sha.clone(), files);
        sha
    }
    fn put_commit(&mut self, tree: String, parent: Option<String>, message: &str) -> String {
        self.counter += 1;
        let sha = blob_sha(format!("commit {tree} {parent:?} {}", self.counter).as_bytes());
        self.commits.insert(
            sha.clone(),
            Commit {
                tree,
                parent,
                message: message.to_string(),
            },
        );
        sha
    }
    /// Dateien im Kopf (Pfad → Inhalt).
    pub fn files(&self) -> BTreeMap<String, Vec<u8>> {
        let Some(head) = &self.head else {
            return BTreeMap::new();
        };
        let tree = &self.trees[&self.commits[head].tree];
        tree.iter()
            .map(|(p, s)| (p.clone(), self.blobs[s].clone()))
            .collect()
    }
    /// Ein anderer Rechner lädt hoch (ohne Wayfarer).
    pub fn commit_files(&mut self, change: &BTreeMap<String, String>) {
        let mut files = self
            .head
            .as_ref()
            .map(|h| self.trees[&self.commits[h].tree].clone())
            .unwrap_or_default();
        for (path, text) in change {
            let sha = self.put_blob(text.as_bytes());
            files.insert(path.clone(), sha);
        }
        let tree = self.put_tree(files);
        let head = self.head.clone();
        let commit = self.put_commit(tree, head, "Wayfarer (Windows-PC): von außen");
        self.head = Some(commit);
    }
    fn descends(&self, commit: &str, ancestor: &str) -> bool {
        let mut at = Some(commit.to_string());
        while let Some(c) = at {
            if c == ancestor {
                return true;
            }
            at = self.commits.get(&c).and_then(|c| c.parent.clone());
        }
        false
    }
}

pub struct Server {
    pub base: Url,
    pub repo: Arc<Mutex<Repo>>,
}

pub fn start() -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let repo = Arc::new(Mutex::new(Repo {
        private: true,
        ..Repo::default()
    }));
    let shared = repo.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { break };
            let repo = shared.clone();
            std::thread::spawn(move || handle(stream, repo, port));
        }
    });
    Server {
        base: Url::parse(&format!("http://127.0.0.1:{port}")).unwrap(),
        repo,
    }
}

fn respond(stream: &mut TcpStream, status: u16, headers: &[(String, String)], body: &[u8]) {
    let mut head = format!(
        "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for (k, v) in headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
}

fn handle(mut stream: TcpStream, repo: Arc<Mutex<Repo>>, port: u16) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut first = String::new();
    if reader.read_line(&mut first).unwrap_or(0) == 0 {
        return;
    }
    let mut headers = Vec::new();
    let mut length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
            break;
        }
        let line = line.trim_end().to_string();
        if let Some((k, v)) = line.split_once(':') {
            if k.eq_ignore_ascii_case("content-length") {
                length = v.trim().parse().unwrap_or(0);
            }
        }
        headers.push(line);
    }
    let mut body = vec![0u8; length];
    let _ = reader.read_exact(&mut body);
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();
    let (path, query) = target.split_once('?').unwrap_or((&target, ""));
    let mut repo = repo.lock().unwrap();
    repo.log.push((format!("{method} {path}"), headers));
    if let Some(n) = repo.drop_after {
        if repo.log.len() > n {
            repo.drop_after = None;
            return; // Verbindung bricht ab, ohne Antwort.
        }
    }
    let line = format!("{method} {path}");
    if let Some(hook) = repo.on_request.as_mut() {
        hook(&line);
    }
    if let Some(i) = repo.forced.iter().position(|f| line.contains(&f.contains)) {
        let forced = repo.forced.remove(i).unwrap();
        let headers = forced.headers.clone();
        drop(repo);
        return respond(&mut stream, forced.status, &headers, forced.body.as_bytes());
    }
    let (status, extra, out) = route(&mut repo, &method, path, query, &body, port);
    drop(repo);
    respond(&mut stream, status, &extra, &out);
}

type Answer = (u16, Vec<(String, String)>, Vec<u8>);

fn json_answer(status: u16, value: Value) -> Answer {
    (
        status,
        vec![("Content-Type".into(), "application/json".into())],
        value.to_string().into_bytes(),
    )
}

fn route(repo: &mut Repo, method: &str, path: &str, query: &str, body: &[u8], port: u16) -> Answer {
    let segments: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    let request: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    match (method, segments.as_slice()) {
        ("GET", ["user"]) => json_answer(200, json!({ "login": "spielleiter" })),
        ("GET", ["user", "repos"]) => json_answer(
            200,
            json!([{ "owner": { "login": "spielleiter" }, "name": "spielstand-elaris", "private": repo.private,
                     "permissions": { "push": true }, "default_branch": "main" }]),
        ),
        ("GET", ["repos", owner, name]) => json_answer(
            200,
            json!({ "owner": { "login": owner }, "name": name, "private": repo.private,
                    "permissions": { "push": true }, "archived": false, "disabled": false, "default_branch": "main" }),
        ),
        ("GET", ["repos", _, _, "git", "ref", "heads", _]) => match &repo.head {
            Some(head) => json_answer(200, json!({ "object": { "sha": head } })),
            None => json_answer(409, json!({ "message": "Git Repository is empty." })),
        },
        ("GET", ["repos", _, _, "compare", range]) => {
            let (base, head) = range.split_once("...").unwrap_or(("", ""));
            if !repo.commits.contains_key(base) {
                return json_answer(404, json!({}));
            }
            let status = if base == head {
                "identical"
            } else if repo.descends(head, base) {
                "ahead"
            } else if repo.descends(base, head) {
                "behind"
            } else {
                "diverged"
            };
            json_answer(200, json!({ "status": status }))
        }
        ("GET", ["repos", _, _, "git", "commits", sha]) => match repo.commits.get(*sha) {
            Some(c) => json_answer(
                200,
                json!({ "tree": { "sha": c.tree }, "message": c.message,
                        "committer": { "date": "2026-11-15T21:40:00Z" } }),
            ),
            None => json_answer(404, json!({})),
        },
        ("GET", ["repos", _, _, "git", "trees", sha]) => {
            let Some(files) = repo.trees.get(*sha).cloned() else {
                // Unterordner-Bäume: Kennung „dir-<baum>-<präfix mit Punkten>“.
                return sub_tree(repo, sha);
            };
            if query.contains("recursive=1") {
                let truncated = repo.truncate;
                let entries: Vec<Value> = files
                    .iter()
                    .take(if truncated { 1 } else { usize::MAX })
                    .map(|(p, s)| json!({ "path": p, "type": "blob", "sha": s, "mode": "100644" }))
                    .collect();
                json_answer(200, json!({ "tree": entries, "truncated": truncated }))
            } else {
                listing(sha, &files, "")
            }
        }
        ("GET", ["repos", _, _, "git", "blobs", sha]) => match repo.blobs.get(*sha) {
            Some(bytes) => (200, vec![], bytes.clone()),
            None => json_answer(404, json!({})),
        },
        ("GET", ["repos", _, _, "tarball", commit]) => (
            302,
            vec![(
                "Location".into(),
                format!("http://127.0.0.1:{port}/archiv/{commit}?token=geheim"),
            )],
            vec![],
        ),
        ("GET", ["archiv", commit]) => {
            let Some(c) = repo.commits.get(*commit) else {
                return json_answer(404, json!({}));
            };
            let files: Vec<(String, Vec<u8>)> = repo.trees[&c.tree]
                .iter()
                .map(|(p, s)| (p.clone(), repo.blobs[s].clone()))
                .collect();
            let refs: Vec<(&str, &[u8])> = files.iter().map(|(p, b)| (p.as_str(), b.as_slice())).collect();
            (
                200,
                vec![],
                archive::build(&format!("spielleiter-spielstand-{commit}"), &refs),
            )
        }
        ("PUT", ["repos", _, _, "contents", "README.md"]) => {
            if repo.head.is_some() {
                return json_answer(422, json!({ "message": "exists" }));
            }
            let sha = repo.put_blob(b"# Spielstand\n");
            let tree = repo.put_tree(BTreeMap::from([("README.md".to_string(), sha)]));
            let commit = repo.put_commit(tree.clone(), None, "README");
            repo.head = Some(commit.clone());
            json_answer(
                201,
                json!({ "commit": { "sha": commit, "tree": { "sha": tree } } }),
            )
        }
        ("POST", ["repos", _, _, "git", "trees"]) => {
            let Some(base) = request["base_tree"].as_str() else {
                return json_answer(422, json!({ "message": "base_tree fehlt" }));
            };
            let Some(mut files) = repo.trees.get(base).cloned() else {
                return json_answer(422, json!({ "message": "unbekannter base_tree" }));
            };
            for entry in request["tree"].as_array().into_iter().flatten() {
                let path = entry["path"].as_str().unwrap_or("").to_string();
                if entry.get("sha").is_some_and(Value::is_null) {
                    files.remove(&path);
                } else if let Some(content) = entry["content"].as_str() {
                    let sha = repo.put_blob(content.as_bytes());
                    files.insert(path, sha);
                }
            }
            let tree = repo.put_tree(files);
            json_answer(201, json!({ "sha": tree }))
        }
        ("POST", ["repos", _, _, "git", "commits"]) => {
            let tree = request["tree"].as_str().unwrap_or("").to_string();
            let parent = request["parents"][0].as_str().map(str::to_string);
            let message = request["message"].as_str().unwrap_or("").to_string();
            let commit = repo.put_commit(tree, parent, &message);
            json_answer(201, json!({ "sha": commit }))
        }
        ("PATCH", ["repos", _, _, "git", "refs", "heads", _]) => {
            if let Some(change) = repo.push_in_before_patch.take() {
                repo.commit_files(&change);
            }
            if request["force"] != json!(false) {
                return json_answer(400, json!({ "message": "force muss false sein" }));
            }
            let sha = request["sha"].as_str().unwrap_or("").to_string();
            let parent = repo.commits.get(&sha).and_then(|c| c.parent.clone());
            if parent != repo.head {
                return json_answer(422, json!({ "message": "Update is not a fast forward" }));
            }
            repo.head = Some(sha.clone());
            json_answer(200, json!({ "object": { "sha": sha } }))
        }
        _ => json_answer(404, json!({ "message": "Not Found" })),
    }
}

/// Eine Ebene eines Baums (für das Lesen je Ordner bei `truncated`).
fn listing(tree: &str, files: &BTreeMap<String, String>, prefix: &str) -> Answer {
    let mut entries = Vec::new();
    let mut dirs = std::collections::BTreeSet::new();
    for (path, sha) in files {
        let Some(rest) = path.strip_prefix(prefix) else {
            continue;
        };
        match rest.split_once('/') {
            None => entries.push(json!({ "path": rest, "type": "blob", "sha": sha, "mode": "100644" })),
            Some((dir, _)) => {
                dirs.insert(dir.to_string());
            }
        }
    }
    for dir in dirs {
        entries.push(json!({ "path": dir, "type": "tree", "sha": format!("dir-{tree}-{}", format!("{prefix}{dir}/").replace('/', ".")), "mode": "040000" }));
    }
    json_answer(200, json!({ "tree": entries, "truncated": false }))
}

fn sub_tree(repo: &Repo, sha: &str) -> Answer {
    let Some(rest) = sha.strip_prefix("dir-") else {
        return json_answer(404, json!({}));
    };
    let Some((tree, prefix)) = rest.split_once('-') else {
        return json_answer(404, json!({}));
    };
    let prefix = prefix.replace('.', "/");
    match repo.trees.get(tree) {
        Some(files) => listing(tree, files, &prefix),
        None => json_answer(404, json!({})),
    }
}
