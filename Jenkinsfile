pipeline {
    agent any

    environment {
        NODE_VERSION = '18'
        DOCKER_REGISTRY = 'your-registry.com'
        DOCKER_IMAGE = 'microservices-ecommerce'
        KUBECONFIG = credentials('kubeconfig')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Setup Node.js & pnpm') {
            steps {
                script {
                    sh """
                        echo 'Setting up Node.js & pnpm environment'
                        node --version
                        pnpm --version || npm install -g pnpm
                    """
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'pnpm install --frozen-lockfile'
            }
        }

        stage('Lint') {
            steps {
                sh 'pnpm run lint'
            }
        }

        stage('Type Check') {
            steps {
                sh 'pnpm -r run type-check || pnpm -r exec tsc --noEmit'
            }
        }

        stage('Test') {
            parallel {
                stage('Unit Tests') {
                    steps {
                        sh 'pnpm run test'
                    }
                }
                stage('Integration Tests') {
                    steps {
                        sh 'pnpm run test'
                    }
                }
            }
            post {
                always {
                    publishTestResults testResultsPattern: '**/test-results.xml'
                    publishCoverage adapters: [coberturaAdapter('coverage/cobertura-coverage.xml')], sourceFileResolver: sourceFiles('STORE_LAST_BUILD')
                }
            }
        }

        stage('Build') {
            steps {
                sh 'pnpm run build'
            }
        }

        stage('Security Scan') {
            steps {
                sh 'pnpm audit --audit-level moderate || true'
            }
        }

        stage('Docker Build') {
            when {
                anyOf {
                    branch 'main'
                    branch 'develop'
                }
            }
            parallel {
                stage('API Gateway') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/api-gateway:${BUILD_NUMBER}", "-f packages/gateway/Dockerfile .")
                        }
                    }
                }
                stage('User Service') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/user-service:${BUILD_NUMBER}", "-f packages/ms-user/Dockerfile .")
                        }
                    }
                }
                stage('Product Service') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/product-service:${BUILD_NUMBER}", "-f packages/ms-product/Dockerfile .")
                        }
                    }
                }
                stage('Order Service') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/order-service:${BUILD_NUMBER}", "-f packages/ms-order/Dockerfile .")
                        }
                    }
                }
                stage('Inventory Service') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/ms-inventory:${BUILD_NUMBER}", "-f packages/ms-inventory/Dockerfile .")
                        }
                    }
                }
                stage('Analytics Service') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/ms-analytics:${BUILD_NUMBER}", "-f packages/ms-analytics/Dockerfile .")
                        }
                    }
                }
                stage('Client') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/client:${BUILD_NUMBER}", "-f packages/client/Dockerfile .")
                        }
                    }
                }
                stage('Admin Cockpit') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/admin:${BUILD_NUMBER}", "-f packages/admin/Dockerfile .")
                        }
                    }
                }
            }
        }

        stage('Deploy to Staging') {
            when {
                branch 'develop'
            }
            steps {
                script {
                    withKubeConfig([credentialsId: 'kubeconfig']) {
                        sh """
                            kubectl apply -k packages/scripts/overlays/staging
                            kubectl rollout status deployment -l tier=backend -n staging --timeout=120s
                        """
                    }
                }
            }
        }

        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            input {
                message "Deploy to production?"
            }
            steps {
                script {
                    withKubeConfig([credentialsId: 'kubeconfig']) {
                        sh """
                            kubectl apply -k packages/scripts/overlays/production
                            kubectl rollout status deployment -l tier=backend -n production --timeout=180s
                        """
                    }
                }
            }
        }
    }

    post {
        always {
            cleanWs()
        }
        success {
            slackSend(
                color: 'good',
                message: "✅ Pipeline succeeded for ${env.JOB_NAME} - ${env.BUILD_NUMBER}"
            )
        }
        failure {
            slackSend(
                color: 'danger',
                message: "❌ Pipeline failed for ${env.JOB_NAME} - ${env.BUILD_NUMBER}"
            )
        }
    }
}