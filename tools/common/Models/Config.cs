﻿using System;
using System.IO;
using System.Diagnostics;
using Newtonsoft.Json;
using System.Collections.Generic;
using Parse;
using System.Threading.Tasks;
using System.Linq;
using System.Text.RegularExpressions;
using System.Collections;
using System.Text;
using Benchmarker.Common.Git;

namespace Benchmarker.Common.Models
{
	public class Config
	{
		public string Name { get; set; }
		public int Count { get; set; }
		public bool NoMono {get; set; }
		public bool PrintEnv  {get; set; } = true;
		public string Mono { get; set; }
		public string[] MonoOptions { get; set; }
		public Dictionary<string, string> MonoEnvironmentVariables { get; set; }
		public string ResultsDirectory { get; set; }

		Dictionary<string, string> processedMonoEnvironmentVariables;

		public Config ()
		{
		}

		public static Config LoadFrom (string filename, string root)
		{
			using (var reader = new StreamReader (new FileStream (filename, FileMode.Open))) {
				var config = JsonConvert.DeserializeObject<Config> (reader.ReadToEnd ());

				if (String.IsNullOrEmpty (config.Name))
					throw new InvalidDataException ("Name");

				if (config.NoMono) {
					Debug.Assert (config.MonoOptions == null || config.MonoOptions.Length == 0);
					Debug.Assert (config.MonoEnvironmentVariables == null || config.MonoEnvironmentVariables.Count == 0);
				}

				if (String.IsNullOrEmpty (config.Mono)) {
					config.Mono = String.Empty;
				} else if (root != null) {
					config.Mono = config.Mono.Replace ("$ROOT", root);
				}

				if (config.Count < 1)
					config.Count = 10;

				if (config.MonoOptions == null)
					config.MonoOptions = new string[0];

				if (config.MonoEnvironmentVariables == null)
					config.MonoEnvironmentVariables = new Dictionary<string, string> ();

				config.processedMonoEnvironmentVariables = new Dictionary<string, string> ();

				foreach (var kvp in config.MonoEnvironmentVariables)
					config.processedMonoEnvironmentVariables [kvp.Key] = kvp.Value.Replace ("$ROOT", root);

				if (String.IsNullOrEmpty (config.ResultsDirectory))
					config.ResultsDirectory = "results";

				return config;
			}
		}

		public ProcessStartInfo NewProcessStartInfo ()
		{
			var info = new ProcessStartInfo {
				UseShellExecute = false,
				RedirectStandardOutput = true,
				RedirectStandardError = true,
			};

			if (!NoMono) {
				if (Mono == null) {
					Console.Error.WriteLine ("Error: No mono executable specified.");
					Environment.Exit (1);
				}
				info.FileName = Mono;
			}

			foreach (var env in processedMonoEnvironmentVariables)
				info.EnvironmentVariables.Add (env.Key, env.Value);
		
			return info;
		}

		public string PrintableEnvironmentVariables (ProcessStartInfo info)
		{
			if (!PrintEnv) {
				return "";
			}
			var builder = new StringBuilder ();
			foreach (DictionaryEntry entry in info.EnvironmentVariables) {
				builder.Append (entry.Key.ToString ());
				builder.Append ("=");
				builder.Append (entry.Value.ToString ());
				builder.Append (" ");
			}
			return builder.ToString ();
		}

		static Octokit.GitHubClient gitHubClient;
		static Octokit.GitHubClient GitHubClient {
			get {
				if (gitHubClient == null) {
					gitHubClient = new Octokit.GitHubClient (new Octokit.ProductHeaderValue ("XamarinBenchmark"));
					if (gitHubClient == null)
						throw new Exception ("Could not instantiate GitHub client");
				}
				return gitHubClient;
			}
		}

		public async Task<Commit> GetCommit (string optionalCommitHash)
		{
			if (NoMono) {
				// FIXME: return a dummy commit
				return null;
			}

			var info = NewProcessStartInfo ();
			/* Run without timing with --version */
			info.Arguments = "--version";

			Console.Out.WriteLine ("\t$> {0} {1} {2}", PrintableEnvironmentVariables (info), info.FileName, info.Arguments);

			var process = Process.Start (info);
			var version = Task.Run (() => new StreamReader (process.StandardOutput.BaseStream).ReadToEnd ()).Result;
			var versionError = Task.Run (() => new StreamReader (process.StandardError.BaseStream).ReadToEnd ()).Result;

			process.WaitForExit ();
			process.Close ();

			var line = version.Split (new char[] {'\n'}, 2) [0];
			var regex = new Regex ("^Mono JIT.*\\((.*)/([0-9a-f]+) (.*)\\)");
			var match = regex.Match (line);

			var commit = new Commit ();

			if (match.Success) {
				commit.Branch = match.Groups [1].Value;
				commit.Hash = match.Groups [2].Value;
				var date = match.Groups [3].Value;
				Console.WriteLine ("branch: " + commit.Branch + " hash: " + commit.Hash + " date: " + date);
			} else {
				if (optionalCommitHash == null) {
					Console.WriteLine ("Error: cannot parse mono version and no commit given.");
					return null;
				}
			}

			if (commit.Branch == "(detached")
				commit.Branch = null;

			if (optionalCommitHash != null) {
				if (commit.Hash != null && !optionalCommitHash.StartsWith (commit.Hash)) {
					Console.WriteLine ("Error: Commit hash specified on command line does not match the one reported with --version.");
					return null;
				}
				commit.Hash = optionalCommitHash;
			}

			try {
				var repo = new Repository (Path.GetDirectoryName (Mono));
				var gitHash = repo.RevParse (commit.Hash);
				if (gitHash == null) {
					Console.WriteLine ("Could not get commit " + commit.Hash + " from repository");
				} else {
					Console.WriteLine ("Got commit " + gitHash + " from repository");

					if (optionalCommitHash != null && optionalCommitHash != gitHash) {
						Console.WriteLine ("Error: Commit hash specified on command line does not match the one from the git repository.");
						return null;
					}

					commit.Hash = gitHash;
					commit.MergeBaseHash = repo.MergeBase (commit.Hash, "master");
					commit.CommitDate = repo.CommitDate (commit.Hash);

					if (commit.CommitDate == null) {
						Console.WriteLine ("Error: Could not get commit date from the git repository.");
						return null;
					}

					Console.WriteLine ("Commit {0} merge base {1} date {2}", commit.Hash, commit.MergeBaseHash, commit.CommitDate);
				}
			} catch (Exception) {
				Console.WriteLine ("Could not get git repository");
			}

			var github = GitHubClient;
			Octokit.Commit gitHubCommit = null;
			try {
				gitHubCommit = await github.GitDatabase.Commit.Get ("mono", "mono", commit.Hash);
			} catch (Octokit.NotFoundException) {
				Console.WriteLine ("Commit " + commit.Hash + " not found on GitHub");
			}
			if (gitHubCommit == null) {
				Console.WriteLine ("Could not get commit " + commit.Hash + " from GitHub");
			} else {
				if (optionalCommitHash != null && optionalCommitHash != gitHubCommit.Sha) {
					Console.WriteLine ("Error: Commit hash specified on command line does not match the one from GitHub.");
					return null;
				}

				commit.Hash = gitHubCommit.Sha;
				if (commit.CommitDate == null)
					commit.CommitDate = gitHubCommit.Committer.Date.DateTime;
				Console.WriteLine ("Got commit " + commit.Hash + " from GitHub");
			}

			return commit;
		}
			
		public override bool Equals (object other)
		{
			if (other == null)
				return false;

			var config = other as Config;
			if (config == null)
				return false;

			return Name.Equals (config.Name);
		}

		public override int GetHashCode ()
		{
			return Name.GetHashCode ();
		}

		static bool OptionsEqual (IEnumerable<string> native, IEnumerable<object> parse)
		{
			if (parse == null)
				return false;
			foreach (var s in native) {
				var found = false;
				foreach (var p in parse) {
					var ps = p as string;
					if (s == ps) {
						found = true;
						break;
					}
				}
				if (!found)
					return false;
			}
			return true;
		}

		static bool EnvironmentVariablesEqual (IDictionary<string, string> native, IDictionary<string, object> parse)
		{
			if (parse == null)
				return false;
			foreach (var kv in native) {
				if (!parse.ContainsKey (kv.Key))
					return false;
				var v = parse [kv.Key] as string;
				if (v != kv.Value)
					return false;
			}
			return true;
		}

		public async Task<ParseObject> GetOrUploadToParse (List<ParseObject> saveList)
		{
			var executable = Path.GetFileName (Mono);

			var results = await ParseObject.GetQuery ("Config")
				.WhereEqualTo ("name", Name)
				.WhereEqualTo ("monoExecutable", executable)
				.FindAsync ();
			foreach (var o in results) {
				if (OptionsEqual (MonoOptions, o ["monoOptions"] as IEnumerable<object>)
				    && EnvironmentVariablesEqual (MonoEnvironmentVariables, o ["monoEnvironmentVariables"] as IDictionary<string, object>)) {
					Console.WriteLine ("found config " + o.ObjectId);
					return o;
				}
			}

			Console.WriteLine ("creating new config");

			var obj = ParseInterface.NewParseObject ("Config");
			obj ["name"] = Name;
			obj ["monoExecutable"] = executable;
			obj ["monoOptions"] = MonoOptions;
			obj ["monoEnvironmentVariables"] = MonoEnvironmentVariables;
			saveList.Add (obj);
			return obj;
		}
	}
}
