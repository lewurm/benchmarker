﻿using System;
using Parse;
using Nito.AsyncEx;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using Benchmarker.Common.Models;

namespace Benchmarker.Common
{
	public class ParseInterface
	{
		private const string parseCredentialsFilename = "parse.pw";

		static ParseACL defaultACL;

		private static void WaitForConfirmation (string key)
		{
			Console.WriteLine ("Log in on browser for access, confirmation key {0}", key);
			ParseQuery<ParseObject> query = ParseObject.GetQuery ("CredentialsResponse").WhereEqualTo ("key", key);
			while (true) {
				var task = query.FirstOrDefaultAsync ();
				task.Wait ();

				var result = task.Result;
				if (result != null)
					break;
				Thread.Sleep (1000);
			}
			Console.WriteLine ("Login successful");
		}

		private static string GetResponse (string url, string parameters)
		{
			WebRequest webRequest = WebRequest.Create(url);
			byte[] dataStream = Encoding.UTF8.GetBytes (parameters);
			webRequest.Method = "POST";
			webRequest.ContentType = "application/x-www-form-urlencoded";
			webRequest.ContentLength = dataStream.Length;
			using (Stream requestStream = webRequest.GetRequestStream ()) {
				requestStream.Write (dataStream, 0, dataStream.Length);
			}
			WebResponse webResponse = webRequest.GetResponse ();
			string response = new StreamReader(webResponse.GetResponseStream ()).ReadToEnd ();
			return response;
		}

		public static bool Initialize ()
		{
			try {
				Credentials credentials;

				ParseClient.Initialize ("7khPUBga9c7L1YryD1se1bp6VRzKKJESc0baS9ES", "FwqUX9gNQP5HmP16xDcZRoh0jJRCDvdoDpv8L87p");

				credentials = Credentials.LoadFromFile (parseCredentialsFilename);

				if (credentials == null) {
					string key = Guid.NewGuid ().ToString ();
					string secret = Guid.NewGuid ().ToString ();

					/* Get github OAuth authentication link */
					string oauthLink = GetResponse ("https://benchmarker.parseapp.com/requestCredentials", string.Format("service=benchmarker&key={0}&secret={1}", key, secret));

					/* Log in github OAuth */
					System.Diagnostics.Process.Start (oauthLink);

					/* Wait for login confirmation */
					WaitForConfirmation (key);

					/* Request the password */
					credentials = Credentials.LoadFromString (GetResponse ("https://benchmarker.parseapp.com/getCredentials", string.Format ("key={0}&secret={1}", key, secret)));

					/* Cache it in the current folder for future use */
					Credentials.WriteToFile (credentials, parseCredentialsFilename);

				}

				var user = AsyncContext.Run (() => ParseUser.LogInAsync (credentials.Username, credentials.Password));

				Console.WriteLine ("User authenticated: " + user.IsAuthenticated);

				var acl = new ParseACL (user);
				acl.PublicReadAccess = true;
				acl.PublicWriteAccess = false;

				defaultACL = acl;
			} catch (Exception e) {
				Console.WriteLine ("Exception : {0}", e.Message);
				return false;
			}
			return true;
		}

		public static ParseObject NewParseObject (string className)
		{
			if (defaultACL == null)
				throw new Exception ("ParseInterface must be initialized before ParseObjects can be created.");
			var obj = new ParseObject (className);
			obj.ACL = defaultACL;
			return obj;
		}
	}
}
