package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
	"strconv"
	"strings"
)

type runsetPostResponse struct {
	RunSetID int32
}

type requestError struct {
	Explanation string
	httpStatus  int
}

func (rerr *requestError) Error() string {
	return rerr.Explanation
}

func (rerr *requestError) httpError(w http.ResponseWriter) {
	errorString := "{\"Explanation\": \"unknown\"}"
	bytes, err := json.Marshal(rerr)
	if err == nil {
		errorString = string(bytes)
	}
	http.Error(w, errorString, rerr.httpStatus)
}

func badRequestError(explanation string) *requestError {
	return &requestError{Explanation: explanation, httpStatus: http.StatusBadRequest}
}

func internalServerError(explanation string) *requestError {
	return &requestError{Explanation: explanation, httpStatus: http.StatusInternalServerError}
}

func ensureBenchmarksAndMetricsExist(rs *RunSet) *requestError {
	benchmarks, reqErr := fetchBenchmarks()
	if reqErr != nil {
		return reqErr
	}

	for _, run := range rs.Runs {
		if !benchmarks[run.Benchmark] {
			return badRequestError("Benchmark does not exist: " + run.Benchmark)
		}
		for m, v := range run.Results {
			if !metricIsAllowed(m, v) {
				return badRequestError("Metric not supported or results of wrong type: " + m)
			}
		}
	}

	for _, b := range rs.TimedOutBenchmarks {
		if !benchmarks[b] {
			return badRequestError("Benchmark does not exist: " + b)
		}
	}
	for _, b := range rs.CrashedBenchmarks {
		if !benchmarks[b] {
			return badRequestError("Benchmark does not exist: " + b)
		}
	}

	return nil
}

func runsetHandlerInTransaction(w http.ResponseWriter, r *http.Request, body []byte) (bool, *requestError) {
	var params RunSet
	if err := json.Unmarshal(body, &params); err != nil {
		fmt.Printf("Unmarshal error: %s\n", err.Error())
		return false, badRequestError("Could not parse request body")
	}

	reqErr := ensureMachineExists(params.Machine)
	if reqErr != nil {
		return false, reqErr
	}

	mainCommit, reqErr := ensureProductExists(params.MainProduct)
	if reqErr != nil {
		return false, reqErr
	}

	var secondaryCommits []string
	for _, p := range params.SecondaryProducts {
		commit, reqErr := ensureProductExists(p)
		if reqErr != nil {
			return false, reqErr
		}
		secondaryCommits = append(secondaryCommits, commit)
	}

	reqErr = ensureBenchmarksAndMetricsExist(&params)
	if reqErr != nil {
		return false, reqErr
	}

	reqErr = ensureConfigExists(params.Config)
	if reqErr != nil {
		return false, reqErr
	}

	var runSetID int32
	err := database.QueryRow("insertRunSet",
		params.StartedAt, params.FinishedAt,
		params.BuildURL, params.LogURLs,
		mainCommit, secondaryCommits, params.Machine.Name, params.Config.Name,
		params.TimedOutBenchmarks, params.CrashedBenchmarks).Scan(&runSetID)
	if err != nil {
		fmt.Printf("run set insert error: %s\n", err)
		return false, internalServerError("Could not insert run set")
	}

	reqErr = insertRuns(runSetID, params.Runs)
	if reqErr != nil {
		return false, reqErr
	}

	resp := runsetPostResponse{RunSetID: runSetID}
	respBytes, err := json.Marshal(&resp)
	if err != nil {
		return false, internalServerError("Could not produce JSON for response")
	}

	w.WriteHeader(http.StatusCreated)
	w.Header().Set("Content-Type", "application/json; charset=UTF-8")
	w.Write(respBytes)

	return true, nil
}

func specificRunsetHandlerInTransaction(w http.ResponseWriter, r *http.Request, body []byte) (bool, *requestError) {
	pathComponents := strings.Split(r.URL.Path, "/")
	if len(pathComponents) != 3 || pathComponents[1] != "runset" {
		return false, badRequestError("Incorrect path")
	}
	runSetID64, err := strconv.ParseInt(pathComponents[2], 10, 32)
	if err != nil {
		return false, badRequestError("Could not parse run set id")
	}
	runSetID := int32(runSetID64)

	var params RunSet
	if err := json.Unmarshal(body, &params); err != nil {
		fmt.Printf("Unmarshal error: %s\n", err.Error())
		return false, badRequestError("Could not parse request body")
	}

	rs, reqErr := fetchRunSet(runSetID)
	if reqErr != nil {
		return false, reqErr
	}

	reqErr = ensureBenchmarksAndMetricsExist(rs)
	if reqErr != nil {
		return false, reqErr
	}

	if params.MainProduct != rs.MainProduct ||
		!productSetsEqual(params.SecondaryProducts, rs.SecondaryProducts) ||
		params.Machine != rs.Machine ||
		!params.Config.isSameAs(&rs.Config) {
		return false, badRequestError("Parameters do not match database")
	}

	rs.amendWithDataFrom(&params)

	reqErr = insertRuns(runSetID, params.Runs)
	if reqErr != nil {
		return false, reqErr
	}

	reqErr = updateRunSet(runSetID, rs)
	if reqErr != nil {
		return false, reqErr
	}

	w.WriteHeader(http.StatusCreated)
	w.Header().Set("Content-Type", "application/json; charset=UTF-8")
	w.Write([]byte("{}"))

	return true, nil
}

func newTransactionHandler(method string, f func(w http.ResponseWriter, r *http.Request, body []byte) (bool, *requestError)) func(w http.ResponseWriter, r *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		var reqErr *requestError
		if r.Method != method {
			reqErr = &requestError{Explanation: "Only POST method allowed", httpStatus: http.StatusMethodNotAllowed}
		} else {
			body, err := ioutil.ReadAll(r.Body)
			r.Body.Close()
			if err != nil {
				reqErr = internalServerError("Could not read request body")
			} else {
				transaction, err := database.Begin()
				if err != nil {
					reqErr = internalServerError("Could not begin transaction")
				} else {
					var commit bool
					commit, reqErr = f(w, r, body)
					if commit {
						transaction.Commit()
					} else {
						transaction.Rollback()
					}
				}
			}
		}
		if reqErr != nil {
			reqErr.httpError(w)
		}
	}
}

func notFoundHandler(w http.ResponseWriter, r *http.Request) {
	reqErr := &requestError{Explanation: "No such endpoint", httpStatus: http.StatusNotFound}
	reqErr.httpError(w)
}

func main() {
	portFlag := flag.Int("port", 8081, "port on which to listen")
	credentialsFlag := flag.String("credentials", "benchmarkerCredentials", "path of the credentials file")
	flag.Parse()

	initGitHub()

	if err := initDatabase(*credentialsFlag); err != nil {
		fmt.Fprintf(os.Stderr, "Error: Cannot init DB: %s\n", err.Error())
		os.Exit(1)
	}

	http.HandleFunc("/runset", newTransactionHandler("POST", runsetHandlerInTransaction))
	http.HandleFunc("/runset/", newTransactionHandler("POST", specificRunsetHandlerInTransaction))
	http.HandleFunc("/", notFoundHandler)

	fmt.Printf("listening\n")
	if err := http.ListenAndServe(fmt.Sprintf(":%d", *portFlag), nil); err != nil {
		fmt.Fprintf(os.Stderr, "Error: Listen failed: %s\n", err.Error())
		os.Exit(1)
	}
}
