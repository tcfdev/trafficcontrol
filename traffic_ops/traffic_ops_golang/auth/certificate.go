package auth

import (
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"io/fs"
	"io/ioutil"
	"net/http"
	"path/filepath"
)

/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

// ParseCertificate takes a http.Request, pulls the (optionally) provided client TLS
// certificates and attempts to verify them against the directory of provided Root CA
// certificates. The Root CA certificates can be different than those utilized by the
// http.Server. Returns a bool signifying whether the verification process was
// successful or an error if one was encountered.
func VerifyClientCertificate(r *http.Request, rootCertsDirPath string) (bool, error) {
	// TODO: Parse client headers

	if err := loadRootCerts(rootCertsDirPath); err != nil {
		return false, fmt.Errorf("failed to load root certificates")
	}

	if err := verifyClientRootChain(r.TLS.PeerCertificates); err != nil {
		return false, fmt.Errorf("failed to verify client to root certificate chain")
	}

	return true, nil
}

func verifyClientRootChain(clientChain []*x509.Certificate) error {
	if len(clientChain) == 0 {
		return fmt.Errorf("empty client chain")
	}

	if rootPool == nil {
		return fmt.Errorf("uninitialized root cert pool")
	}

	intermediateCertPool := x509.NewCertPool()
	for _, intermediate := range clientChain[1:] {
		intermediateCertPool.AddCert(intermediate)
	}

	opts := x509.VerifyOptions{
		Intermediates: intermediateCertPool,
		Roots:         rootPool,
		KeyUsages:     []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	_, err := clientChain[0].Verify(opts)
	if err != nil {
		return fmt.Errorf("failed to verify client cert chain. err: %w", err)
	}
	return nil
}

// Lazy initialized, only added to once, need mutex?
var rootPool *x509.CertPool

func loadRootCerts(dirPath string) error {
	// Root cert pool already populated
	if rootPool != nil {
		return nil
	}

	if dirPath == "" {
		return fmt.Errorf("empty path supplied for root cert directory")
	}

	err := filepath.WalkDir(dirPath,
		// walk function to perform on each file in the supplied
		// directory path for root certificiates.
		//
		// For each file in the directory, first check if it, too, is a dir. If so,
		// return the filepath.SkipDir error to allow for it to be skipped without
		// stopping the subsequent executions.
		//
		// If of type File, then load the PEM encoded string from the file and
		// attempt to decode the PEM block into an x509 certificate. If successful,
		// add that certificate to the Root Cert Pool to be used for verification.
		//
		// Must be a closure for access to the `dirPath` value
		func(path string, file fs.DirEntry, e error) error {
			if e != nil {
				return e
			}

			// Skip logic if root directory
			if path == dirPath {
				return nil
			}

			// Don't traverse nested directories
			if file.IsDir() {
				return filepath.SkipDir
			}

			pemBytes, err := ioutil.ReadFile(path)
			if err != nil {
				return fmt.Errorf("failed to open cert at %s. err: %w", path, err)
			}
			pemBlock, _ := pem.Decode(pemBytes)
			certificate, err := x509.ParseCertificate(pemBlock.Bytes)
			if err != nil {
				return fmt.Errorf("failed to parse PEM into x509. err: %w", err)
			}

			if rootPool == nil {
				rootPool = x509.NewCertPool()
			}
			rootPool.AddCert(certificate)

			fmt.Printf("Added cert %s\n", path)

			return nil
		})
	if err != nil {
		return fmt.Errorf("failed to load root certs from path %s. err: %w", dirPath, err)
	}

	return nil
}

// ParseClientCertificateUID takes an x509 Certificate and loops through the Names in the
// Subject. If it finds an asn.ObjectIdentifier that matches UID, it returns the
// corresponding value. Otherwise returns empty string. If more than one UID is present,
// the first result found to match is returned (order not guaranteed).
func ParseClientCertificateUID(cert *x509.Certificate) string {

	// Object Identifier value for UID used within LDAP
	// LDAP OID reference: https://ldap.com/ldap-oid-reference-guide/
	// 0.9.2342.19200300.100.1.1	uid	Attribute Type
	// asn1.ObjectIdentifier([]int{0, 9, 2342, 19200300, 100, 1, 1})

	for _, name := range cert.Subject.Names {
		t := name.Type
		if len(t) == 7 && t[0] == 0 && t[1] == 9 && t[2] == 2342 && t[3] == 19200300 && t[4] == 100 && t[5] == 1 && t[6] == 1 {
			return name.Value.(string)
		}
	}

	return ""
}
